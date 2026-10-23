import {
  type ApprovePayrollInput,
  type CreatePayrollPeriodInput,
  type CreatePayrollRunInput,
  type FieldError,
  P,
  type PayrollFlag,
  type PayrollItemDetail,
  type PayrollItemQuery,
  type PayrollRunQuery,
  type PayrollRunStatus,
  type PayrollValidation,
  type ReturnPayrollRunInput,
  type VersionInput,
} from '@hrm/contracts';
import { type Queryable, type schema, uuidv7 } from '@hrm/db';
import {
  blockingCode,
  buildSnapshot,
  type CalculatedItem,
  calculateItem,
  calculateOffCycleItem,
  checkSelfApproval,
  isRunLocked,
  monthPeriod,
  PAYROLL_RULE_VERSION,
  type PayrollRunAction,
  type PayrollSnapshot,
  payrollRunTransition,
  validationFlags,
} from '@hrm/domain';
import { recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import { withDbErrors } from '../../lib/db-errors';
import type { Deps } from '../../lib/deps';
import { enqueue } from '../../lib/outbox';
import { pageMeta, pageOffset } from '../../lib/pagination';
import { AppError, invalidTransition, notFound, ruleViolation, versionConflict } from '../../lib/problem';
import { getSettings } from '../../lib/settings';
import { decideApproval, openApproval, stepRecipients } from '../approvals/approvals.service';
import { money, toItem, toPeriod, toRun } from './payroll.dto';
import { payrollPolicy as policy } from './payroll.policy';
import * as repo from './payroll.repository';

const runSubject = (id: string) => ({ type: 'payroll_run' as const, id });

/** Checks the run transition (DOMAIN-MODEL 5.6). A change to a locked run is PAYROLL_RUN_LOCKED (FR-PAY-011). */
export function assertRunAction(status: PayrollRunStatus, action: PayrollRunAction) {
  const t = payrollRunTransition(status, action);
  if (t.ok) return t.to;
  if (isRunLocked(status) && (action === 'calculate' || action === 'validate' || action === 'return'))
    throw new AppError('PAYROLL_RUN_LOCKED', 'Payroll run is locked', 'Use an adjustment in a later run.');
  throw invalidTransition(status, action.replace('_', ' '));
}

async function lockRunFor(
  tx: Parameters<typeof repo.lockRun>[0],
  auth: AuthContext,
  id: string,
  action: PayrollRunAction,
  version?: number,
) {
  const view = await repo.lockRun(tx, auth.companyId, id);
  if (!view) throw notFound();
  const to = assertRunAction(view.run.status, action);
  if (version !== undefined && view.run.version !== version) throw versionConflict();
  return { ...view, to };
}

const totalsMeta = (r: repo.RunRow) => ({
  employeeCount: r.employeeCount,
  totalGross: r.totalGross,
  totalDeductions: r.totalDeductions,
  totalNet: r.totalNet,
});

async function reloadRun(deps: Deps, auth: AuthContext, id: string) {
  const view = await repo.findRun(deps.db, auth.companyId, id);
  if (!view) throw notFound();
  return toRun(view);
}

// Periods ------------------------------------------------------------------------------------------------------------

export async function listPeriods(
  deps: Deps,
  auth: AuthContext,
  q: { page: number; pageSize: number; year?: number | undefined },
) {
  policy.read(auth);
  const { rows, total } = await repo.listPeriods(deps.db, auth.companyId, q.year, q.pageSize, pageOffset(q));
  return { data: rows.map(toPeriod), page: pageMeta(q, total) };
}

export async function createPeriod(deps: Deps, auth: AuthContext, input: CreatePayrollPeriodInput) {
  policy.prepare(auth);
  const { start, end } = monthPeriod(input.year, input.month);
  const row = await deps.db.transaction((tx) =>
    withDbErrors(
      () =>
        repo.insertPeriod(tx, {
          id: uuidv7(),
          companyId: auth.companyId,
          year: input.year,
          month: input.month,
          startDate: start,
          endDate: end,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        }),
      { payroll_periods_uq: { code: 'DUPLICATE', path: '/month' } },
    ),
  );
  return toPeriod(row);
}

// Runs ---------------------------------------------------------------------------------------------------------------

export async function listRuns(deps: Deps, auth: AuthContext, q: PayrollRunQuery) {
  policy.read(auth);
  const { rows, total } = await repo.listRuns(
    deps.db,
    auth.companyId,
    { ...(q.periodId ? { periodId: q.periodId } : {}), ...(q.status ? { status: q.status } : {}) },
    q.pageSize,
    pageOffset(q),
  );
  return { data: rows.map(toRun), page: pageMeta(q, total) };
}

export async function getRun(deps: Deps, auth: AuthContext, id: string) {
  policy.read(auth);
  const view = await repo.findRun(deps.db, auth.companyId, id);
  if (!view) throw notFound();
  const summary = await repo.validationSummary(deps.db, id);
  const flags = Object.keys(summary.byFlag).map((f) => [f as PayrollFlag]);
  return { ...toRun(view), validation: { blockingCode: blockingCode(flags), ...summary } };
}

/** `POST /payroll/runs` (US-PAY-002): `PR-YYYY-MM-NN`, NN = run sequence within the period (BUSINESS-RULES §8). */
export async function createRun(deps: Deps, auth: AuthContext, input: CreatePayrollRunInput) {
  policy.prepareStrong(auth);
  const id = uuidv7();
  await deps.db.transaction(async (tx) => {
    // The period row lock serializes run creation, so the sequence is gap-free within the period.
    const period = await repo.lockPeriod(tx, auth.companyId, input.periodId);
    if (!period) throw notFound();
    if (period.status === 'closed' && input.runType === 'regular')
      throw new AppError(
        'PAYROLL_RUN_EXISTS',
        'Payroll run exists',
        'The period is closed by a locked regular run.',
      );
    const n = (await repo.countRunsInPeriod(tx, period.id)) + 1;
    const runNumber = `PR-${period.year}-${String(period.month).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
    await withDbErrors(
      () =>
        repo.insertRun(tx, {
          id,
          companyId: auth.companyId,
          payrollPeriodId: period.id,
          runNumber,
          runType: input.runType,
          preparedBy: auth.userId,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        }),
      { payroll_runs_one_regular_uq: { code: 'PAYROLL_RUN_EXISTS', path: '/periodId' } },
    );
    await recordAudit(tx, auth.actor, {
      action: 'payroll_run.created',
      category: 'payroll',
      entityType: 'payroll_run',
      entityId: id,
      metadata: { runNumber, runType: input.runType, periodId: period.id },
    });
  });
  return reloadRun(deps, auth, id);
}

interface FlagContext {
  runCurrency: string;
  anomalyThresholdPercent: number;
  reviewThreshold: string;
  previousNets: Map<string, string>;
}

async function flagContext(db: Queryable, companyId: string, periodStart: string): Promise<FlagContext> {
  const settings = await getSettings(db, companyId, [
    'company.currency',
    'payroll.anomaly_threshold_percent',
    'reimbursements.review_threshold',
  ]);
  const prev = await repo.previousNets(db, companyId, periodStart);
  return {
    runCurrency: settings['company.currency'],
    anomalyThresholdPercent: settings['payroll.anomaly_threshold_percent'],
    reviewThreshold: settings['reimbursements.review_threshold'],
    previousNets: new Map(prev.map((p) => [p.employee_id, p.net])),
  };
}

/** Flags of one stored item, recomputed from its immutable snapshot (BUSINESS-RULES 6.5). */
function flagsFromSnapshot(
  item: {
    employeeId: string;
    currency: string;
    netAmount: string;
    daysEmployed: number;
    daysInPeriod: number;
  },
  snapshot: PayrollSnapshot,
  ctx: FlagContext,
  runType: string,
): PayrollFlag[] {
  return validationFlags({
    runType: runType === 'off_cycle' ? 'off_cycle' : 'regular',
    period: { start: snapshot.period.start, end: snapshot.period.end },
    joiningDate: snapshot.employee.joiningDate,
    separationDate: snapshot.employee.separationDate,
    daysEmployed: item.daysEmployed,
    daysInPeriod: item.daysInPeriod,
    missingSalaryStructure: snapshot.salaryStructures.length === 0 && item.daysEmployed > 0,
    net: item.netAmount,
    runCurrency: ctx.runCurrency,
    sourceCurrencies: [
      item.currency,
      ...snapshot.salaryStructures.map((s) => s.currency ?? item.currency),
      ...snapshot.lines
        .filter((l) => l.code === 'reimbursement')
        .map((l) => (l.calculation as { currency?: string }).currency ?? item.currency),
    ],
    previousNet: ctx.previousNets.get(item.employeeId) ?? null,
    anomalyThresholdPercent: ctx.anomalyThresholdPercent,
    reimbursementAmounts: snapshot.lines.filter((l) => l.code === 'reimbursement').map((l) => l.amount),
    reimbursementReviewThreshold: ctx.reviewThreshold,
  });
}

/**
 * `calculate` (BUSINESS-RULES 6.1–6.7, off-cycle 6.10): deletes and recreates the run's items and lines in one transaction, from the
 * approved structures, eligible claims and approved adjustments. The run row lock makes concurrent calls serialize;
 * the loser sees a new version and gets 409 (PAY-08).
 */
export async function calculateRun(deps: Deps, auth: AuthContext, id: string, input: VersionInput) {
  policy.prepareStrong(auth);
  const now = deps.clock.now();
  const settings = await getSettings(deps.db, auth.companyId, ['payroll.midperiod_salary_change_policy']);
  await deps.db.transaction(async (tx) => {
    const { run, period } = await lockRunFor(tx, auth, id, 'calculate', input.version);
    const offCycle = run.runType === 'off_cycle';
    const p = { start: period.startDate, end: period.endDate };
    const [claims, adjustments, ctx] = await Promise.all([
      repo.eligibleClaims(tx, auth.companyId, run.id, offCycle ? null : p.end),
      repo.eligibleAdjustments(tx, auth.companyId, run.id, period.id),
      flagContext(tx, auth.companyId, p.start),
    ]);
    // An off-cycle run pays only claims and adjustments, to whoever has one (BUSINESS-RULES 6.10).
    const [employees, structures] = offCycle
      ? [
          await repo.employeesByIds(tx, auth.companyId, [
            ...new Set([...claims, ...adjustments].map((r) => r.employee_id)),
          ]),
          [],
        ]
      : await Promise.all([
          repo.eligibleEmployees(tx, auth.companyId, p.start, p.end),
          repo.approvedStructuresFor(tx, auth.companyId, p.start, p.end),
        ]);
    if (offCycle && employees.length === 0)
      throw ruleViolation(
        'Nothing to pay: no approved claim or adjustment for this period is waiting for a run.',
      );
    const group = <T extends { employee_id: string }>(rows: readonly T[]) => {
      const m = new Map<string, T[]>();
      for (const r of rows) m.set(r.employee_id, [...(m.get(r.employee_id) ?? []), r]);
      return m;
    };
    const byStructure = group(structures);
    const byClaim = group(claims);
    const byAdjustment = group(adjustments);

    const unconfirmed: FieldError[] = [];
    const items: (typeof schema.payrollItems.$inferInsert)[] = [];
    const lines: (typeof schema.payrollLineItems.$inferInsert)[] = [];
    function addItem(e: repo.EligibleEmployee, item: CalculatedItem) {
      const itemId = uuidv7();
      const snapshot = buildSnapshot({
        period: { ...p, year: period.year, month: period.month },
        employee: {
          id: e.id,
          code: e.code,
          name: e.name,
          department: e.department,
          position: e.position,
          joiningDate: e.joining_date,
          separationDate: e.separation_date,
        },
        item,
        currency: ctx.runCurrency,
        runType: run.runType === 'off_cycle' ? 'off_cycle' : 'regular',
      });
      const flags = flagsFromSnapshot(
        {
          employeeId: e.id,
          currency: ctx.runCurrency,
          netAmount: item.net,
          daysEmployed: item.daysEmployed,
          daysInPeriod: item.daysInPeriod,
        },
        snapshot,
        ctx,
        run.runType,
      );
      items.push({
        id: itemId,
        companyId: auth.companyId,
        payrollRunId: run.id,
        employeeId: e.id,
        salaryStructureId: item.structuresUsed.at(-1)?.id ?? null,
        currency: ctx.runCurrency,
        grossAmount: item.gross,
        deductionAmount: item.deductions,
        netAmount: item.net,
        daysInPeriod: item.daysInPeriod,
        daysEmployed: item.daysEmployed,
        snapshot,
        validationFlags: flags,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      });
      for (const l of item.lines) {
        lines.push({
          id: uuidv7(),
          payrollItemId: itemId,
          kind: l.kind,
          code: l.code,
          label: l.label,
          amount: l.amount,
          sortOrder: l.sortOrder,
          sourceType: l.sourceType,
          sourceId: l.sourceId,
          calculation: l.calculation,
        });
      }
    }
    for (const e of employees) {
      const claimInputs = (byClaim.get(e.id) ?? []).map((c) => ({
        id: c.id,
        claimNumber: c.claim_number,
        expenseDate: c.expense_date,
        amount: c.amount,
        currency: c.currency,
      }));
      const adjustmentInputs = (byAdjustment.get(e.id) ?? []).map((a) => ({
        id: a.id,
        type: a.type,
        lineCode: a.line_code,
        amount: a.amount,
        reason: a.reason,
      }));
      if (offCycle) {
        const offItem = calculateOffCycleItem({
          period: p,
          claims: claimInputs,
          adjustments: adjustmentInputs,
        });
        if (offItem) addItem(e, offItem);
        continue;
      }
      const result = calculateItem({
        period: p,
        employment: { joiningDate: e.joining_date, separationDate: e.separation_date },
        structures: (byStructure.get(e.id) ?? []).map((s) => ({
          id: s.id,
          grossAmount: s.gross_amount,
          effectiveFrom: s.effective_from,
          effectiveTo: s.effective_to,
          currency: s.currency,
        })),
        claims: claimInputs,
        adjustments: adjustmentInputs,
        midPeriodPolicy: settings['payroll.midperiod_salary_change_policy'],
      });
      if (!result.ok) {
        unconfirmed.push({
          path: `/employees/${e.id}`,
          code: result.reason,
          message: `${e.code}: salary changes in the period.`,
        });
        continue;
      }
      addItem(e, result.item);
    }
    if (unconfirmed.length)
      throw new AppError(
        'PAYROLL_MIDPERIOD_SALARY_CHANGE_UNCONFIRMED',
        'Mid-period salary change policy not set',
        'Set payroll.midperiod_salary_change_policy before calculating (BUSINESS-RULES 6.3).',
        unconfirmed,
      );

    await withDbErrors(async () => {
      await repo.deleteRunItems(tx, run.id);
      await repo.insertItems(tx, items);
      await repo.insertLines(tx, lines);
    });
    const updated = await repo.updateRun(tx, run.id, run.version, {
      status: 'calculated',
      calculatedAt: now,
      calculationRuleVersion: PAYROLL_RULE_VERSION,
      updatedAt: now,
      updatedBy: auth.userId,
    });
    if (!updated) throw versionConflict();
    await repo.refreshRunTotals(tx, run.id);
    const after = await repo.lockRun(tx, auth.companyId, run.id);
    await recordAudit(tx, auth.actor, {
      action: 'payroll_run.calculated',
      category: 'payroll',
      entityType: 'payroll_run',
      entityId: run.id,
      metadata: {
        from: run.status,
        to: 'calculated',
        ruleVersion: PAYROLL_RULE_VERSION,
        ...totalsMeta(after?.run ?? updated),
      },
    });
  });
  return reloadRun(deps, auth, id);
}

/** `validate`: recomputes every item's flags from its snapshot and current settings; the run status does not change. */
export async function validateRun(deps: Deps, auth: AuthContext, id: string): Promise<PayrollValidation> {
  policy.prepare(auth);
  await deps.db.transaction(async (tx) => {
    const { run, period } = await lockRunFor(tx, auth, id, 'validate');
    const ctx = await flagContext(tx, auth.companyId, period.startDate);
    const items = await repo.allItems(tx, id);
    await repo.setItemFlags(
      tx,
      items.map(({ item }) => ({
        id: item.id,
        flags: flagsFromSnapshot(item, item.snapshot as PayrollSnapshot, ctx, run.runType),
      })),
    );
  });
  return validationResult(deps, id);
}

async function validationResult(deps: Deps, id: string): Promise<PayrollValidation> {
  const items = await repo.allItems(deps.db, id);
  const summary = await repo.validationSummary(deps.db, id);
  const flagged = items.filter(({ item }) => item.validationFlags.length > 0);
  return {
    runId: id,
    summary: {
      blockingCode: blockingCode(flagged.map(({ item }) => item.validationFlags as PayrollFlag[])),
      ...summary,
    },
    items: flagged.map((v) => ({
      payrollItemId: v.item.id,
      employee: { id: v.item.employeeId, employeeCode: v.employeeCode, name: v.employeeName },
      flags: v.item.validationFlags as PayrollFlag[],
    })),
  };
}

const BLOCKING: Record<string, string> = {
  no_salary_structure: 'No approved salary structure covers the employed days.',
  negative_net: 'Net amount is negative.',
  currency_mismatch: 'An input is not in the run currency.',
};

/** `calculated` → `submitted` (US-PAY-004); blocked by blocking flags (API-STANDARDS "Payroll blocking codes"). */
export async function submitRun(deps: Deps, auth: AuthContext, id: string, input: VersionInput) {
  policy.prepareStrong(auth);
  const now = deps.clock.now();
  const outboxIds = await deps.db.transaction(async (tx) => {
    const { run, period } = await lockRunFor(tx, auth, id, 'submit', input.version);
    const items = await repo.allItems(tx, id);
    const code = blockingCode(items.map(({ item }) => item.validationFlags as PayrollFlag[]));
    if (code) {
      const errors = items.flatMap(({ item, employeeCode }) =>
        item.validationFlags
          .filter((f) => f in BLOCKING)
          .map((f) => ({ path: `/items/${item.id}`, code: f, message: `${employeeCode}: ${BLOCKING[f]}` })),
      );
      throw new AppError(
        code,
        'Payroll run cannot be submitted',
        'Fix the blocking validation results.',
        errors,
      );
    }
    const updated = await repo.updateRun(tx, id, run.version, {
      status: 'submitted',
      submittedAt: now,
      updatedAt: now,
      updatedBy: auth.userId,
    });
    if (!updated) throw versionConflict();
    const approver = { permission: P.payroll.approve };
    const approvalId = await openApproval(tx, {
      companyId: auth.companyId,
      subject: runSubject(id),
      requesterUserId: auth.userId,
      subjectEmployeeId: null,
      approver,
      actorUserId: auth.userId,
    });
    await recordAudit(tx, auth.actor, {
      action: 'payroll_run.submitted',
      category: 'payroll',
      entityType: 'payroll_run',
      entityId: id,
      metadata: { from: run.status, to: 'submitted', ...totalsMeta(run) },
    });
    const recipients = (await stepRecipients(tx, auth.companyId, approver)).filter((u) => u !== auth.userId);
    // EMAIL.md: no salary amounts in email; the approver opens the run in the app.
    return enqueue(
      tx,
      auth.actor,
      ...recipients.map((userId) => ({
        topic: 'email.approval_requested' as const,
        payload: {
          recipientUserId: userId,
          subjectLabel: `Payroll run ${run.runNumber}`,
          requesterName: auth.user.name,
          facts: [
            `Period: ${period.year}-${String(period.month).padStart(2, '0')}`,
            `Employees: ${run.employeeCount ?? 0}`,
          ],
          path: `/approvals/${approvalId}`,
        },
        dedupeKey: `payroll_run.submitted:${id}:${updated.version}:${userId}`,
      })),
    );
  });
  return { run: await reloadRun(deps, auth, id), outboxIds };
}

/**
 * `calculated`/`submitted` → `returned` → `draft` in one transaction (DOMAIN-MODEL 5.6, US-PAY-005). Items stay until
 * the next calculation replaces them; claims and adjustments are only marked at lock, so they stay `approved`.
 */
export async function returnRun(deps: Deps, auth: AuthContext, id: string, input: ReturnPayrollRunInput) {
  policy.approveStrong(auth);
  const now = deps.clock.now();
  const outboxIds = await deps.db.transaction(async (tx) => {
    const { run } = await lockRunFor(tx, auth, id, 'return', input.version);
    let recipient = run.preparedBy;
    if (run.status === 'submitted') {
      const step = await decideApproval(tx, auth, {
        subject: runSubject(id),
        decision: 'rejected',
        comment: input.reason,
        now,
        onBehalfOf: null,
        allowSelf: true,
      });
      recipient = step.requesterUserId;
    }
    const updated = await repo.updateRun(tx, id, run.version, {
      status: 'draft',
      returnedReason: input.reason,
      updatedAt: now,
      updatedBy: auth.userId,
    });
    if (!updated) throw versionConflict();
    await recordAudit(tx, auth.actor, {
      action: 'payroll_run.returned',
      category: 'payroll',
      entityType: 'payroll_run',
      entityId: id,
      metadata: { from: run.status, to: 'returned', next: 'draft', reason: input.reason },
    });
    if (!recipient || recipient === auth.userId) return [];
    return enqueue(tx, auth.actor, {
      topic: 'email.payroll_run_returned',
      payload: {
        recipientUserId: recipient,
        runNumber: run.runNumber,
        reason: input.reason,
        path: `/payroll/runs/${id}`,
      },
      dedupeKey: `payroll_run.returned:${id}:${updated.version}`,
    });
  });
  return { run: await reloadRun(deps, auth, id), outboxIds };
}

/** `submitted` → `approved` (US-PAY-005). The preparer or submitter may approve with a justification (D-007). */
export async function approveRun(deps: Deps, auth: AuthContext, id: string, input: ApprovePayrollInput) {
  const now = deps.clock.now();
  policy.approveFresh(auth, now);
  const allowSelf = (await getSettings(deps.db, auth.companyId, ['payroll.allow_self_approval']))[
    'payroll.allow_self_approval'
  ];
  const outboxIds = await deps.db.transaction(async (tx) => {
    const { run } = await lockRunFor(tx, auth, id, 'approve', input.version);
    const requester = await repo.openApprovalRequester(tx, auth.companyId, { payrollRunId: id });
    const self = checkSelfApproval({
      isSelf: run.preparedBy === auth.userId || requester === auth.userId,
      allowSelfApproval: allowSelf,
      note: input.selfApprovalNote,
    });
    if (!self.ok)
      throw new AppError(
        self.reason,
        self.reason === 'SELF_APPROVAL_FORBIDDEN'
          ? 'You cannot approve your own run'
          : 'Justification required',
        self.reason === 'SELF_APPROVAL_NOTE_REQUIRED'
          ? 'Explain why you approve a run you prepared (at least 20 characters).'
          : undefined,
        self.reason === 'SELF_APPROVAL_NOTE_REQUIRED'
          ? [{ path: '/selfApprovalNote', code: 'required', message: 'At least 20 characters.' }]
          : [],
      );
    const step = await decideApproval(tx, auth, {
      subject: runSubject(id),
      decision: 'approved',
      comment: input.comment ?? null,
      now,
      onBehalfOf: null,
      allowSelf: true,
    });
    const updated = await repo.updateRun(tx, id, run.version, {
      status: 'approved',
      approvedAt: now,
      approvedBy: auth.userId,
      selfApproved: self.selfApproved,
      selfApprovalNote: self.note,
      updatedAt: now,
      updatedBy: auth.userId,
    });
    if (!updated) throw versionConflict();
    await recordAudit(tx, auth.actor, {
      action: 'payroll_run.approved',
      category: 'payroll',
      entityType: 'payroll_run',
      entityId: id,
      metadata: {
        from: run.status,
        to: 'approved',
        comment: input.comment ?? null,
        selfApproved: self.selfApproved,
        ...(self.selfApproved ? { note: self.note } : {}),
        ...totalsMeta(run),
      },
    });
    if (step.requesterUserId === auth.userId) return [];
    return enqueue(tx, auth.actor, {
      topic: 'email.request_decided',
      payload: {
        recipientUserId: step.requesterUserId,
        subjectLabel: `Payroll run ${run.runNumber}`,
        decision: 'approved',
        comment: input.comment ?? null,
        reviewerUserId: auth.userId,
        path: `/payroll/runs/${id}`,
      },
      dedupeKey: `payroll_run.approved:${id}`,
    });
  });
  return { run: await reloadRun(deps, auth, id), outboxIds };
}

/**
 * `approved` → `locked` (BUSINESS-RULES 6.8): linked claims become `included`, linked adjustments `applied`, and the
 * period closes for a regular run, all in one transaction.
 */
export async function lockRun(deps: Deps, auth: AuthContext, id: string, input: VersionInput) {
  const now = deps.clock.now();
  policy.lockFresh(auth, now);
  await deps.db.transaction(async (tx) => {
    const { run } = await lockRunFor(tx, auth, id, 'lock', input.version);
    const [claimLines] = await repo.lineSourceCount(tx, id, 'reimbursement_claim');
    const [adjustmentLines] = await repo.lineSourceCount(tx, id, 'payroll_adjustment');
    const claims = await repo.includeClaims(tx, id, auth.userId, now);
    const adjustments = await repo.applyAdjustments(tx, id, auth.userId, now);
    if (claims.length !== (claimLines?.n ?? 0) || adjustments.length !== (adjustmentLines?.n ?? 0))
      throw ruleViolation(
        'A claim or adjustment in this run changed since it was calculated. Return and recalculate.',
      );
    for (const a of adjustments) {
      await recordAudit(tx, auth.actor, {
        action: 'payroll_adjustment.applied',
        category: 'payroll',
        entityType: 'payroll_adjustment',
        entityId: a.id,
        employeeId: a.employee_id,
        metadata: {
          from: 'approved',
          to: 'applied',
          payrollRunId: id,
          payrollItemId: a.applied_payroll_item_id,
        },
      });
    }
    const updated = await repo.updateRun(tx, id, run.version, {
      status: 'locked',
      lockedAt: now,
      lockedBy: auth.userId,
      updatedAt: now,
      updatedBy: auth.userId,
    });
    if (!updated) throw versionConflict();
    if (run.runType === 'regular') await repo.closePeriod(tx, run.payrollPeriodId, auth.userId, now);
    await recordAudit(tx, auth.actor, {
      action: 'payroll_run.locked',
      category: 'payroll',
      entityType: 'payroll_run',
      entityId: id,
      metadata: {
        from: run.status,
        to: 'locked',
        includedClaims: claims.length,
        appliedAdjustments: adjustments.length,
        ...totalsMeta(run),
      },
    });
  });
  return reloadRun(deps, auth, id);
}

// Items --------------------------------------------------------------------------------------------------------------

async function assertRunExists(deps: Deps, auth: AuthContext, id: string) {
  const view = await repo.findRun(deps.db, auth.companyId, id);
  if (!view) throw notFound();
  return view;
}

export async function listItems(deps: Deps, auth: AuthContext, id: string, q: PayrollItemQuery) {
  policy.read(auth);
  await assertRunExists(deps, auth, id);
  const { rows, total } = await repo.listItems(
    deps.db,
    id,
    { ...(q.employeeId ? { employeeId: q.employeeId } : {}), ...(q.flag ? { flag: q.flag } : {}) },
    q.pageSize,
    pageOffset(q),
  );
  return { data: rows.map(toItem), page: pageMeta(q, total) };
}

export async function getItem(
  deps: Deps,
  auth: AuthContext,
  id: string,
  itemId: string,
): Promise<PayrollItemDetail> {
  policy.read(auth);
  await assertRunExists(deps, auth, id);
  const view = await repo.findItem(deps.db, id, itemId);
  if (!view) throw notFound();
  const lines = await repo.itemLines(deps.db, itemId);
  return {
    ...toItem(view),
    lines: lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      code: l.code,
      label: l.label,
      amount: money(l.amount),
      sortOrder: l.sortOrder,
      sourceType: l.sourceType,
      sourceId: l.sourceId,
      calculation: l.calculation as Record<string, unknown>,
    })),
    snapshot: view.item.snapshot as Record<string, unknown>,
  };
}
