import type {
  AttendanceReportQuery,
  AttendanceReportRow,
  DirectoryQuery,
  DirectoryRow,
  HeadcountQuery,
  HeadcountRow,
  LeaveReportQuery,
  LeaveReportRow,
  Money,
  PaymentReconciliationRow,
  PayrollDeductionRow,
  PayrollDeductionsQuery,
  PayrollRegisterRow,
  PayrollRunReportQuery,
  ReimbursementReportQuery,
  ReimbursementReportRow,
  ReportExportInput,
} from '@hrm/contracts';
import { Decimal, toBusinessDate, toMoneyString } from '@hrm/domain';
import { recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import type { Deps } from '../../lib/deps';
import { type PageQuery, pageMeta, pageOffset } from '../../lib/pagination';
import { notFound } from '../../lib/problem';
import { PAYROLL_REPORTS, reportsPolicy as policy } from './reports.policy';
import * as repo from './reports.repository';

const EMPLOYEE_STATUSES = [
  'draft',
  'preboarding',
  'probation',
  'active',
  'notice_period',
  'separated',
  'archived',
] as const;

const bdt = (amount: string): Money => ({ amount, currency: 'BDT' });
const paging = (q: PageQuery) => ({ limit: q.pageSize, offset: pageOffset(q) });
const page = (q: PageQuery, rows: readonly { total_items: string | number }[]) =>
  pageMeta(q, Number(rows[0]?.total_items ?? 0));

const employeeRef = (r: repo.EmployeeColumns) => ({
  employeeId: r.employee_id,
  employeeCode: r.employee_code,
  employeeName: r.employee_name,
  departmentName: r.department_name,
});

const runRef = (r: repo.RunRow) => ({
  id: r.id,
  runNumber: r.run_number,
  status: r.status,
  periodYear: r.period_year,
  periodMonth: r.period_month,
});

// HR reports ------------------------------------------------------------------------------------------------------

export async function headcount(deps: Deps, auth: AuthContext, q: HeadcountQuery) {
  policy.require(auth, 'headcount');
  const asOf = q.asOf ?? toBusinessDate(deps.clock.now());
  const rows = await repo.headcount(deps.db, auth.companyId, {
    asOf,
    departmentId: q.departmentId,
    groupBy: q.groupBy,
    ...paging(q),
  });
  const data: HeadcountRow[] = rows.map((r) => ({
    ...(q.groupBy === 'status' ? {} : { groupId: r.group_key }),
    groupLabel: r.group_label,
    total: r.total,
    byStatus: {
      ...Object.fromEntries(EMPLOYEE_STATUSES.map((s) => [s, 0])),
      ...r.by_status,
    } as HeadcountRow['byStatus'],
  }));
  return { data, page: page(q, rows), summary: { asOf, total: Number(rows[0]?.grand_total ?? 0) } };
}

export async function directory(deps: Deps, auth: AuthContext, q: DirectoryQuery) {
  const scope = await policy.employeeScope(auth, 'directory');
  const rows = await repo.directory(deps.db, auth.companyId, scope, {
    departmentId: q.departmentId,
    status: q.status,
    ...paging(q),
  });
  const data: DirectoryRow[] = rows.map((r) => ({
    ...employeeRef(r),
    status: r.status as DirectoryRow['status'],
    positionTitle: r.position_title,
    managerName: r.manager_name,
    workEmail: r.work_email,
    workPhone: r.work_phone,
    joiningDate: r.joining_date,
  }));
  return { data, page: page(q, rows) };
}

export async function attendance(deps: Deps, auth: AuthContext, q: AttendanceReportQuery) {
  const scope = await policy.employeeScope(auth, 'attendance');
  const rows = await repo.attendance(deps.db, auth.companyId, scope, {
    from: q.from,
    to: q.to,
    departmentId: q.departmentId,
    employeeId: q.employeeId,
    ...paging(q),
  });
  const data: AttendanceReportRow[] = rows.map((r) => ({
    ...employeeRef(r),
    days: {
      present: r.present,
      shortHours: r.short_hours,
      missedCore: r.missed_core,
      missingPunch: r.missing_punch,
      absent: r.absent,
      onLeave: r.on_leave,
      holiday: r.holiday,
      weekend: r.weekend,
    },
    workedMinutes: r.worked_minutes,
    lateMinutes: r.late_minutes,
    earlyLeaveMinutes: r.early_leave_minutes,
    needsReview: r.needs_review,
  }));
  return { data, page: page(q, rows) };
}

/** The leave year is `year`, else the year of `from`, else the current business year; the period defaults to it. */
export async function leave(deps: Deps, auth: AuthContext, q: LeaveReportQuery) {
  const scope = await policy.employeeScope(auth, 'leave');
  const year = q.year ?? Number((q.from ?? toBusinessDate(deps.clock.now())).slice(0, 4));
  const rows = await repo.leave(deps.db, auth.companyId, scope, {
    year,
    from: q.from ?? `${year}-01-01`,
    to: q.to ?? `${year}-12-31`,
    leaveTypeId: q.leaveTypeId,
    departmentId: q.departmentId,
    ...paging(q),
  });
  const data: LeaveReportRow[] = rows.map((r) => ({
    ...employeeRef(r),
    leaveTypeId: r.leave_type_id,
    leaveTypeCode: r.leave_type_code,
    leaveTypeName: r.leave_type_name,
    entitled: r.entitled,
    used: r.used,
    reserved: r.reserved,
    adjusted: r.adjusted,
    available: r.available,
    takenInPeriod: r.taken_in_period,
  }));
  return { data, page: page(q, rows) };
}

// Payroll reports -------------------------------------------------------------------------------------------------

async function runOrNotFound(deps: Deps, auth: AuthContext, runId: string) {
  const run = await repo.findRun(deps.db, auth.companyId, runId);
  if (!run) throw notFound();
  return run;
}

const totals = (t: repo.RunTotalsRow) => ({
  employeeCount: t.employee_count,
  grossAmount: bdt(t.gross),
  deductionAmount: bdt(t.deductions),
  netAmount: bdt(t.net),
});

export async function payrollRegister(deps: Deps, auth: AuthContext, q: PayrollRunReportQuery) {
  policy.require(auth, 'payroll_register');
  const run = await runOrNotFound(deps, auth, q.runId);
  const rows = await repo.payrollRegister(deps.db, run.id, paging(q));
  const sums = await repo.runTotals(deps.db, run.id);
  const data: PayrollRegisterRow[] = rows.map((r) => ({
    ...employeeRef(r),
    payrollItemId: r.payroll_item_id,
    daysInPeriod: r.days_in_period,
    daysEmployed: r.days_employed,
    grossAmount: bdt(r.gross),
    deductionAmount: bdt(r.deductions),
    netAmount: bdt(r.net),
    reimbursementAmount: bdt(r.reimbursements),
    paymentStatus: r.payment_status,
    validationFlags: r.validation_flags,
  }));
  return { data, page: page(q, rows), summary: { run: runRef(run), totals: totals(sums) } };
}

export async function payrollDeductions(deps: Deps, auth: AuthContext, q: PayrollDeductionsQuery) {
  policy.require(auth, 'payroll_deductions');
  if (q.runId) await runOrNotFound(deps, auth, q.runId);
  const rows = await repo.payrollDeductions(deps.db, auth.companyId, {
    runId: q.runId,
    year: q.year,
    ...paging(q),
  });
  const data: PayrollDeductionRow[] = rows.map((r) => ({
    ...employeeRef(r),
    runId: r.run_id,
    runNumber: r.run_number,
    periodYear: r.period_year,
    periodMonth: r.period_month,
    code: r.code,
    label: r.label,
    amount: bdt(r.amount),
  }));
  return { data, page: page(q, rows), summary: { totalAmount: bdt(rows[0]?.total_amount ?? '0.00') } };
}

export async function paymentReconciliation(deps: Deps, auth: AuthContext, q: PayrollRunReportQuery) {
  policy.require(auth, 'payment_reconciliation');
  const run = await runOrNotFound(deps, auth, q.runId);
  const rows = await repo.paymentReconciliation(deps.db, run.id, paging(q));
  const sums = await repo.runTotals(deps.db, run.id);
  const data: PaymentReconciliationRow[] = rows.map((r) => ({
    ...employeeRef(r),
    payrollItemId: r.payroll_item_id,
    grossAmount: bdt(r.gross),
    deductionAmount: bdt(r.deductions),
    netAmount: bdt(r.net),
    paidAmount: bdt(r.paid),
    differenceAmount: bdt(r.difference),
    paymentCount: r.payment_count,
    methods: r.methods,
    lastPaidOn: r.last_paid_on,
    paymentStatus: r.payment_status,
  }));
  return {
    data,
    page: page(q, rows),
    summary: {
      run: runRef(run),
      totals: {
        ...totals(sums),
        paidAmount: bdt(sums.paid),
        differenceAmount: bdt(toMoneyString(new Decimal(sums.net).minus(sums.paid))),
      },
    },
  };
}

export async function reimbursements(deps: Deps, auth: AuthContext, q: ReimbursementReportQuery) {
  policy.require(auth, 'reimbursements');
  const rows = await repo.reimbursements(deps.db, auth.companyId, {
    from: q.from,
    to: q.to,
    status: q.status,
    ...paging(q),
  });
  const data: ReimbursementReportRow[] = rows.map((r) => ({
    ...employeeRef(r),
    claimId: r.claim_id,
    claimNumber: r.claim_number,
    category: r.category,
    expenseDate: r.expense_date,
    amount: bdt(r.amount),
    status: r.status as ReimbursementReportRow['status'],
    submittedAt: r.submitted_at,
    decidedAt: r.decided_at,
    runNumber: r.run_number,
  }));
  return {
    data,
    page: page(q, rows),
    summary: { count: Number(rows[0]?.total_items ?? 0), totalAmount: bdt(rows[0]?.total_amount ?? '0.00') },
  };
}

// Export log ------------------------------------------------------------------------------------------------------

/** Records that the caller exported a report (FR-REP-005, AUDIT.md §3); the browser builds the file (D-037). */
export async function recordExport(deps: Deps, auth: AuthContext, input: ReportExportInput) {
  policy.require(auth, input.report);
  await recordAudit(deps.db, auth.actor, {
    action: 'report.exported',
    category: PAYROLL_REPORTS.includes(input.report) ? 'payroll' : 'business',
    entityType: 'report',
    entityId: null,
    metadata: {
      report: input.report,
      format: input.format ?? null,
      filters: input.filters,
      rowCount: input.rowCount,
    },
  });
}
