import type {
  CancelPaymentInput,
  FieldError,
  ImportPaymentsInput,
  PaymentImportResult,
  PublishPayslipsResult,
  Reconciliation,
  RecordPaymentInput,
  VersionInput,
} from '@hrm/contracts';
import { type Tx, uuidv7 } from '@hrm/db';
import { checkPayment, Decimal, parsePaymentsCsv, periodLabel, toMoneyString } from '@hrm/domain';
import { recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import { withDbErrors } from '../../lib/db-errors';
import type { Deps } from '../../lib/deps';
import { enqueue } from '../../lib/outbox';
import { AppError, invalidTransition, notFound, validationFailed, versionConflict } from '../../lib/problem';
import { money, toPayment, toRun } from './payroll.dto';
import { payrollPolicy as policy } from './payroll.policy';
import * as repo from './payroll.repository';
import { assertRunAction } from './payroll.service';

const PAYMENT_CONSTRAINTS = {
  payroll_payments_cheque_uq: { code: 'DUPLICATE', path: '/chequeNumber' },
} as const;

const mismatch = (detail: string, errors: FieldError[] = []) =>
  new AppError('PAYMENT_AMOUNT_MISMATCH', 'Payment amount mismatch', detail, errors);

async function lockRunForPayment(tx: Tx, auth: AuthContext, runId: string) {
  const view = await repo.lockRun(tx, auth.companyId, runId);
  if (!view) throw notFound();
  assertRunAction(view.run.status, 'pay');
  return view;
}

/** Writes one payment for an item and marks the item paid (D-021, D-042: one payment for exactly the net). */
async function recordOne(
  tx: Tx,
  auth: AuthContext,
  runId: string,
  input: RecordPaymentInput,
  now: Date,
  path = '',
): Promise<string> {
  const item = await repo.lockItem(tx, runId, input.payrollItemId);
  if (!item)
    throw validationFailed([
      { path: `${path}/payrollItemId`, code: 'not_found', message: 'Item not found.' },
    ]);
  const check = checkPayment({
    net: item.item.netAmount,
    amount: input.amount.amount,
    itemPaymentStatus: item.item.paymentStatus,
  });
  if (!check.ok) {
    const detail = {
      AMOUNT_MISMATCH: `The amount must equal the item's net amount ${item.item.netAmount}; split payments are not supported.`,
      ALREADY_PAID: 'The item is already paid.',
      NOTHING_DUE: 'The item has no amount to pay.',
    }[check.reason];
    throw mismatch(detail, [{ path: `${path}/amount`, code: check.reason.toLowerCase(), message: detail }]);
  }
  const id = uuidv7();
  await withDbErrors(
    () =>
      repo.insertPayment(tx, {
        id,
        companyId: auth.companyId,
        payrollItemId: item.item.id,
        method: input.method,
        amount: input.amount.amount,
        paidOn: input.paidOn,
        chequeNumber: input.method === 'cheque' ? (input.chequeNumber ?? null) : null,
        reference: input.reference ?? null,
        acknowledgedByName: input.acknowledgedByName ?? null,
        status: 'paid',
        createdBy: auth.userId,
        updatedBy: auth.userId,
      }),
    PAYMENT_CONSTRAINTS,
  );
  await repo.setItemPaymentStatus(tx, item.item.id, 'paid', auth.userId, now);
  await recordAudit(tx, auth.actor, {
    action: 'payroll_payment.recorded',
    category: 'payroll',
    entityType: 'payroll_payment',
    entityId: id,
    employeeId: item.item.employeeId,
    metadata: {
      payrollRunId: runId,
      payrollItemId: item.item.id,
      amount: input.amount.amount,
      method: input.method,
      chequeNumber: input.chequeNumber ?? null,
    },
  });
  return id;
}

async function reloadPayment(deps: Deps, auth: AuthContext, id: string) {
  const view = await repo.findPayment(deps.db, auth.companyId, id);
  if (!view) throw notFound();
  return toPayment(view);
}

/** `POST /payroll/runs/{id}/payments` (US-PAY-007). The run stays `locked` until `mark-paid`. */
export async function recordPayment(deps: Deps, auth: AuthContext, runId: string, input: RecordPaymentInput) {
  const now = deps.clock.now();
  policy.payFresh(auth, now);
  const id = await deps.db.transaction(async (tx) => {
    await lockRunForPayment(tx, auth, runId);
    return recordOne(tx, auth, runId, input, now);
  });
  return reloadPayment(deps, auth, id);
}

/**
 * `POST /payroll/runs/{id}/payments/import` (API-CATALOGUE §8). Every row is checked first; a dry run returns the
 * preview, a real run records all rows in one transaction or none (422 with every row error).
 */
export async function importPayments(
  deps: Deps,
  auth: AuthContext,
  runId: string,
  input: ImportPaymentsInput,
  dryRun: boolean,
): Promise<PaymentImportResult> {
  const now = deps.clock.now();
  policy.payFresh(auth, now);
  const parsed = parsePaymentsCsv(input.csv);
  if (!parsed.ok)
    throw validationFailed([
      { path: '/csv', code: parsed.reason.toLowerCase(), message: `CSV rejected: ${parsed.reason}.` },
    ]);
  const view = await repo.findRun(deps.db, auth.companyId, runId);
  if (!view) throw notFound();
  assertRunAction(view.run.status, 'pay');

  const rows = parsed.rows;
  const items = new Map(
    (
      await repo.itemsByEmployeeCode(deps.db, runId, [
        ...new Set(rows.map((r) => r.employeeCode).filter(Boolean)),
      ])
    ).map((i) => [i.employeeCode, i]),
  );
  const cheques = rows.map((r) => r.chequeNumber).filter((c): c is string => Boolean(c));
  const chequesInUse = await repo.chequeNumbersInUse(deps.db, auth.companyId, cheques);
  const seenCodes = new Set<string>();
  const seenCheques = new Set<string>();
  const result = rows.map((r) => {
    const errors = [...r.errors];
    const item = items.get(r.employeeCode) ?? null;
    if (r.employeeCode && !item)
      errors.push({ code: 'not_in_run', message: 'No item for this employee in the run.' });
    if (r.employeeCode && seenCodes.has(r.employeeCode))
      errors.push({ code: 'duplicate_employee', message: 'The employee appears more than once.' });
    seenCodes.add(r.employeeCode);
    if (r.method === 'cheque' && r.chequeNumber) {
      if (chequesInUse.has(r.chequeNumber) || seenCheques.has(r.chequeNumber))
        errors.push({ code: 'duplicate_cheque', message: 'The cheque number is already used.' });
      seenCheques.add(r.chequeNumber);
    }
    if (item && r.errors.length === 0) {
      const check = checkPayment({
        net: item.netAmount,
        amount: r.amount,
        itemPaymentStatus: item.paymentStatus,
      });
      if (!check.ok)
        errors.push({ code: check.reason.toLowerCase(), message: 'Payment does not match the item.' });
    }
    return {
      line: r.line,
      employeeCode: r.employeeCode,
      payrollItemId: item?.id ?? null,
      method: r.method,
      amount: r.amount,
      paidOn: r.paidOn,
      chequeNumber: r.chequeNumber,
      errors,
      source: r,
    };
  });
  const invalid = result.filter((r) => r.errors.length > 0);
  const out = (applied: boolean): PaymentImportResult => ({
    dryRun,
    applied,
    validRows: result.length - invalid.length,
    invalidRows: invalid.length,
    rows: result.map(({ source: _s, ...r }) => r),
  });
  if (dryRun) return out(false);
  if (invalid.length)
    throw validationFailed(
      invalid.flatMap((r) =>
        r.errors.map((e) => ({ path: `/csv/${r.line}`, code: e.code, message: e.message })),
      ),
    );
  await deps.db.transaction(async (tx) => {
    await lockRunForPayment(tx, auth, runId);
    for (const r of result) {
      await recordOne(
        tx,
        auth,
        runId,
        {
          payrollItemId: r.payrollItemId as string,
          method: r.method as 'cash' | 'cheque',
          amount: { amount: r.amount, currency: 'BDT' },
          paidOn: r.paidOn,
          ...(r.source.chequeNumber ? { chequeNumber: r.source.chequeNumber } : {}),
          ...(r.source.reference ? { reference: r.source.reference } : {}),
          ...(r.source.acknowledgedByName ? { acknowledgedByName: r.source.acknowledgedByName } : {}),
        },
        now,
        `/csv/${r.line}`,
      );
    }
  });
  return out(true);
}

/**
 * `POST /payroll/payments/{paymentId}/cancel`: payments are never edited (DATA-MODEL §7). A wrong entry becomes
 * `cancelled`, a bounced cheque `failed`; the item can then be paid again with a new row (PAY-11).
 */
export async function cancelPayment(
  deps: Deps,
  auth: AuthContext,
  paymentId: string,
  input: CancelPaymentInput,
) {
  const now = deps.clock.now();
  policy.payFresh(auth, now);
  await deps.db.transaction(async (tx) => {
    const found = await repo.lockPayment(tx, auth.companyId, paymentId);
    if (!found) throw notFound();
    await lockRunForPayment(tx, auth, found.runId);
    const p = found.payment;
    if (p.status !== 'paid') throw invalidTransition(p.status, 'cancel');
    await repo.updatePayment(tx, p.id, {
      status: input.outcome,
      cancelledReason: input.reason,
      updatedAt: now,
      updatedBy: auth.userId,
    });
    await repo.setItemPaymentStatus(
      tx,
      p.payrollItemId,
      input.outcome === 'failed' ? 'failed' : 'unpaid',
      auth.userId,
      now,
    );
    const item = await repo.findItem(tx, found.runId, p.payrollItemId);
    await recordAudit(tx, auth.actor, {
      action: 'payroll_payment.cancelled',
      category: 'payroll',
      entityType: 'payroll_payment',
      entityId: p.id,
      employeeId: item?.item.employeeId ?? null,
      metadata: {
        from: 'paid',
        to: input.outcome,
        reason: input.reason,
        amount: p.amount,
        method: p.method,
        chequeNumber: p.chequeNumber,
      },
    });
  });
  return reloadPayment(deps, auth, paymentId);
}

/** `locked` → `paid` when every item with a net amount is paid; included claims become `paid` (BUSINESS-RULES 6.8). */
export async function markPaid(deps: Deps, auth: AuthContext, runId: string, input: VersionInput) {
  const now = deps.clock.now();
  policy.payFresh(auth, now);
  await deps.db.transaction(async (tx) => {
    const view = await repo.lockRun(tx, auth.companyId, runId);
    if (!view) throw notFound();
    assertRunAction(view.run.status, 'mark_paid');
    if (view.run.version !== input.version) throw versionConflict();
    const unpaid = await repo.unpaidItems(tx, runId);
    if (unpaid.length)
      throw mismatch(
        `${unpaid.length} item(s) are not paid.`,
        unpaid.map((i) => ({ path: `/items/${i.id}`, code: `payment_${i.status}`, message: 'Not paid.' })),
      );
    const claims = await repo.payClaims(tx, runId, auth.userId, now);
    const updated = await repo.updateRun(tx, runId, view.run.version, {
      status: 'paid',
      updatedAt: now,
      updatedBy: auth.userId,
    });
    if (!updated) throw versionConflict();
    await recordAudit(tx, auth.actor, {
      action: 'payroll_run.paid',
      category: 'payroll',
      entityType: 'payroll_run',
      entityId: runId,
      metadata: { from: 'locked', to: 'paid', paidClaims: claims.length, totalNet: view.run.totalNet },
    });
  });
  const view = await repo.findRun(deps.db, auth.companyId, runId);
  if (!view) throw notFound();
  return toRun(view);
}

async function reconciliationOf(deps: Deps | { db: Tx }, view: repo.RunView): Promise<Reconciliation> {
  const rows = await repo.reconciliation(deps.db, view.run.id);
  let gross = new Decimal(0);
  let deductions = new Decimal(0);
  let net = new Decimal(0);
  let paid = new Decimal(0);
  const items = rows.map((r) => {
    gross = gross.plus(r.gross);
    deductions = deductions.plus(r.deductions);
    net = net.plus(r.net);
    paid = paid.plus(r.paid);
    const outstanding = new Decimal(r.net).minus(r.paid);
    const exceptions: string[] = [];
    if (r.failed > 0) exceptions.push('payment_failed');
    if (r.cancelled > 0) exceptions.push('payment_cancelled');
    if (outstanding.greaterThan(0) && r.payment_status !== 'paid') exceptions.push('unpaid');
    return {
      payrollItemId: r.id,
      employee: { id: r.employee_id, employeeCode: r.code, name: r.name },
      gross: money(r.gross),
      deductions: money(r.deductions),
      net: money(r.net),
      paid: money(r.paid),
      outstanding: money(toMoneyString(outstanding)),
      paymentStatus: r.payment_status as Reconciliation['items'][number]['paymentStatus'],
      exceptions,
    };
  });
  return {
    runId: view.run.id,
    runNumber: view.run.runNumber,
    status: view.run.status,
    totals: {
      gross: money(gross.toFixed(2)),
      deductions: money(deductions.toFixed(2)),
      net: money(net.toFixed(2)),
      paid: money(paid.toFixed(2)),
      outstanding: money(net.minus(paid).toFixed(2)),
    },
    balanced: items.every((i) => i.outstanding.amount === '0.00'),
    items,
  };
}

/** `GET /payroll/runs/{id}/reconciliation` (FR-PAY-015, PAY-11). */
export async function getReconciliation(deps: Deps, auth: AuthContext, runId: string) {
  policy.read(auth);
  const view = await repo.findRun(deps.db, auth.companyId, runId);
  if (!view) throw notFound();
  return reconciliationOf(deps, view);
}

/** `paid` → `reconciled` when gross, deductions, net and payments agree for every item (US-PAY-008). */
export async function reconcileRun(deps: Deps, auth: AuthContext, runId: string, input: VersionInput) {
  const now = deps.clock.now();
  policy.payFresh(auth, now);
  await deps.db.transaction(async (tx) => {
    const view = await repo.lockRun(tx, auth.companyId, runId);
    if (!view) throw notFound();
    assertRunAction(view.run.status, 'reconcile');
    if (view.run.version !== input.version) throw versionConflict();
    const rec = await reconciliationOf({ db: tx }, view);
    if (!rec.balanced || rec.totals.net.amount !== money(view.run.totalNet).amount)
      throw mismatch(
        'Recorded payments do not match the net amounts.',
        rec.items
          .filter((i) => i.outstanding.amount !== '0.00')
          .map((i) => ({
            path: `/items/${i.payrollItemId}`,
            code: 'outstanding',
            message: i.outstanding.amount,
          })),
      );
    const updated = await repo.updateRun(tx, runId, view.run.version, {
      status: 'reconciled',
      updatedAt: now,
      updatedBy: auth.userId,
    });
    if (!updated) throw versionConflict();
    await recordAudit(tx, auth.actor, {
      action: 'payroll_run.reconciled',
      category: 'payroll',
      entityType: 'payroll_run',
      entityId: runId,
      metadata: {
        from: 'paid',
        to: 'reconciled',
        totalNet: rec.totals.net.amount,
        totalPaid: rec.totals.paid.amount,
      },
    });
  });
  const view = await repo.findRun(deps.db, auth.companyId, runId);
  if (!view) throw notFound();
  return toRun(view);
}

/**
 * `publish-payslips` (BUSINESS-RULES 6.8, D-037): one `payslips` row per item and one email per employee with an active
 * user. The email has the period and a link, never amounts (EMAIL.md).
 */
export async function publishPayslips(
  deps: Deps,
  auth: AuthContext,
  runId: string,
): Promise<{ result: PublishPayslipsResult; outboxIds: string[] }> {
  const now = deps.clock.now();
  policy.payFresh(auth, now);
  return deps.db.transaction(async (tx) => {
    const view = await repo.lockRun(tx, auth.companyId, runId);
    if (!view) throw notFound();
    assertRunAction(view.run.status, 'publish');
    if (view.run.payslipsPublishedAt) throw invalidTransition(view.run.status, 'publish payslips again');
    const items = await repo.itemsToPublish(tx, runId);
    const rows = items.map((i) => ({
      id: uuidv7(),
      companyId: auth.companyId,
      payrollItemId: i.id,
      employeeId: i.employee_id,
      payrollPeriodId: view.period.id,
      publishedAt: now,
      publishedBy: auth.userId,
      userId: i.user_id,
    }));
    await repo.insertPayslips(
      tx,
      rows.map(({ userId: _u, ...r }) => r),
    );
    const updated = await repo.updateRun(tx, runId, view.run.version, {
      payslipsPublishedAt: now,
      updatedAt: now,
      updatedBy: auth.userId,
    });
    if (!updated) throw versionConflict();
    await recordAudit(tx, auth.actor, {
      action: 'payslips.published',
      category: 'payroll',
      entityType: 'payroll_run',
      entityId: runId,
      metadata: { runId, count: rows.length },
    });
    const label = periodLabel(view.period.year, view.period.month);
    const outboxIds = await enqueue(
      tx,
      auth.actor,
      ...rows
        .filter((r) => r.userId)
        .map((r) => ({
          topic: 'email.payslip_published' as const,
          payload: { recipientUserId: r.userId as string, periodLabel: label, path: `/payslips/${r.id}` },
          dedupeKey: `payslip.published:${r.id}`,
        })),
    );
    return { result: { runId, published: rows.length, publishedAt: now.toISOString() }, outboxIds };
  });
}
