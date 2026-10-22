import type { PayslipData, PayslipQuery } from '@hrm/contracts';
import type { PayrollSnapshot } from '@hrm/domain';
import { recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import type { Deps } from '../../lib/deps';
import { isoOrNull } from '../../lib/dto';
import { pageMeta, pageOffset } from '../../lib/pagination';
import { notFound } from '../../lib/problem';
import { money, toPayslipSummary } from './payroll.dto';
import { payrollPolicy as policy } from './payroll.policy';
import * as repo from './payroll.repository';

// Payslips (FR-PAY-013, D-037, US-PAY-009). The server returns immutable data from the item snapshot; the browser
// builds the PDF, so the Worker stays inside its CPU budget (ADR-0009).

export async function listOwnPayslips(
  deps: Deps,
  auth: AuthContext,
  q: { page: number; pageSize: number; year?: number | undefined },
) {
  const scope = policy.ownPayslips(auth);
  const { rows, total } = await repo.listPayslips(
    deps.db,
    scope,
    q.year ? { year: q.year } : {},
    q.pageSize,
    pageOffset(q),
  );
  return { data: rows.map(toPayslipSummary), page: pageMeta(q, total) };
}

export async function listPayslips(deps: Deps, auth: AuthContext, q: PayslipQuery) {
  policy.readAllPayslips(auth);
  const { rows, total } = await repo.listPayslips(
    deps.db,
    auth.scopeAll(),
    {
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      ...(q.periodId ? { periodId: q.periodId } : {}),
      ...(q.year ? { year: q.year } : {}),
    },
    q.pageSize,
    pageOffset(q),
  );
  return { data: rows.map(toPayslipSummary), page: pageMeta(q, total) };
}

/**
 * `GET /payroll/payslips/{id}`: `payslip.read.all` or the owner. The owner's first view sets `firstViewedAt`; that
 * view and every view by someone else are audited as `payslip.viewed` (AUDIT.md §3).
 */
export async function getPayslip(deps: Deps, auth: AuthContext, id: string): Promise<PayslipData> {
  const scope = policy.payslipScope(auth);
  if (!scope) throw notFound();
  const view = await repo.findPayslip(deps.db, scope, id);
  if (!view) throw notFound();
  const isOwner = view.payslip.employeeId === auth.employeeId;
  const now = deps.clock.now();
  let firstViewedAt = view.payslip.firstViewedAt;
  await deps.db.transaction(async (tx) => {
    const first = isOwner && !firstViewedAt ? await repo.markPayslipViewed(tx, id, now) : false;
    if (first) firstViewedAt = now;
    if (!isOwner || first) {
      await recordAudit(tx, auth.actor, {
        action: 'payslip.viewed',
        category: 'payroll',
        entityType: 'payslip',
        entityId: id,
        employeeId: view.payslip.employeeId,
        metadata: { byOwner: isOwner, firstView: first, payrollRunNumber: view.runNumber },
      });
    }
  });

  const snap = view.item.snapshot as PayrollSnapshot;
  const company = await repo.findCompany(deps.db, auth.companyId);
  return {
    id: view.payslip.id,
    company: {
      name: company?.name ?? '',
      legalName: company?.legalName ?? null,
      address: company?.address ?? null,
    },
    employee: {
      id: view.payslip.employeeId,
      employeeCode: snap.employee.code,
      name: snap.employee.name,
      department: snap.employee.department,
      position: snap.employee.position,
      joiningDate: snap.employee.joiningDate,
      separationDate: snap.employee.separationDate,
    },
    period: {
      id: view.period.id,
      year: snap.period.year,
      month: snap.period.month,
      startDate: snap.period.start,
      endDate: snap.period.end,
      daysInPeriod: snap.period.daysInPeriod,
    },
    runNumber: view.runNumber,
    daysEmployed: snap.daysEmployed,
    lines: snap.lines.map((l) => ({ kind: l.kind, code: l.code, label: l.label, amount: money(l.amount) })),
    totals: {
      gross: money(snap.totals.gross),
      deductions: money(snap.totals.deductions),
      net: money(snap.totals.net),
    },
    ruleVersion: snap.ruleVersion,
    paymentStatus: view.item.paymentStatus as PayslipData['paymentStatus'],
    publishedAt: view.payslip.publishedAt.toISOString(),
    firstViewedAt: isoOrNull(firstViewedAt),
  };
}
