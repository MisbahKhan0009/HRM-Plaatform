import type { Queryable, RequestScope } from '@hrm/db';
import { type SQL, sql } from 'drizzle-orm';

// Reports read the module tables directly with one set-based query each (ADR-0009: aggregation stays in SQL).
// Every query filters company_id and the caller's employee scope before any user filter (API-STANDARDS §6).

interface Paging {
  limit: number;
  offset: number;
}

/**
 * A parameter list for `IN (...)`. The client runs with `fetch_types: false` (Hyperdrive), so JavaScript arrays
 * cannot be sent as array parameters.
 */
const list = (values: readonly string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/** Restricts the `employees e` alias to the scope; `true` for `all`, `false` for an empty team. */
function inScope(scope: RequestScope): SQL {
  if (scope.employees === 'all') return sql`true`;
  if (scope.employees.length === 0) return sql`false`;
  return sql`e.id IN (${list(scope.employees)})`;
}

const opt = (value: unknown, condition: SQL) => (value === undefined ? sql`true` : condition);

const employeeName = sql`coalesce(e.preferred_name, e.first_name) || ' ' || e.last_name`;
const employeeColumns = sql`e.id AS employee_id, e.employee_code, ${employeeName} AS employee_name,
  d.name AS department_name`;
const isoTimestamp = (column: SQL) =>
  sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const money = (column: SQL) => sql`coalesce(${column}, 0)::numeric(14, 2)::text`;

export interface EmployeeColumns {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  [key: string]: unknown;
}

// Headcount -------------------------------------------------------------------------------------------------------

export type HeadcountRow = {
  group_key: string | null;
  group_label: string | null;
  total: number;
  by_status: Record<string, number>;
  total_items: string;
  grand_total: string;
};

/**
 * Employees employed on `asOf` (joined on or before it, not separated before it), grouped by their current
 * department, position or status. Historical departments are not reconstructed.
 */
export function headcount(
  db: Queryable,
  companyId: string,
  f: {
    asOf: string;
    departmentId?: string | undefined;
    groupBy: 'department' | 'position' | 'status';
  } & Paging,
) {
  const key = {
    department: sql`department_id::text`,
    position: sql`position_id::text`,
    status: sql`status::text`,
  }[f.groupBy];
  const label = {
    department: sql`(SELECT name FROM departments WHERE id::text = g.group_key)`,
    position: sql`(SELECT title FROM positions WHERE id::text = g.group_key)`,
    status: sql`g.group_key`,
  }[f.groupBy];
  return db.execute<HeadcountRow>(sql`
    WITH base AS (
      SELECT ${key} AS group_key, status::text AS status FROM employees
      WHERE company_id = ${companyId} AND joining_date IS NOT NULL AND joining_date <= ${f.asOf}::date
        AND (separation_date IS NULL OR separation_date >= ${f.asOf}::date)
        AND ${opt(f.departmentId, sql`department_id = ${f.departmentId ?? null}::uuid`)}
    ),
    g AS (SELECT group_key, status, count(*)::int AS n FROM base GROUP BY group_key, status)
    SELECT g.group_key, ${label} AS group_label, sum(g.n)::int AS total,
      jsonb_object_agg(g.status, g.n) AS by_status,
      count(*) OVER () AS total_items, sum(sum(g.n)) OVER () AS grand_total
    FROM g GROUP BY g.group_key
    ORDER BY group_label NULLS LAST, g.group_key NULLS LAST
    LIMIT ${f.limit} OFFSET ${f.offset}`);
}

// Directory -------------------------------------------------------------------------------------------------------

export type DirectoryRow = EmployeeColumns & {
  status: string;
  position_title: string | null;
  manager_name: string | null;
  work_email: string | null;
  work_phone: string | null;
  joining_date: string | null;
  total_items: string;
};

export function directory(
  db: Queryable,
  companyId: string,
  scope: RequestScope,
  f: { departmentId?: string | undefined; status?: string[] | undefined } & Paging,
) {
  return db.execute<DirectoryRow>(sql`
    SELECT ${employeeColumns}, e.status::text AS status, p.title AS position_title,
      coalesce(m.preferred_name, m.first_name) || ' ' || m.last_name AS manager_name,
      e.work_email::text AS work_email, e.work_phone, e.joining_date::text AS joining_date,
      count(*) OVER () AS total_items
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN positions p ON p.id = e.position_id
    LEFT JOIN employees m ON m.id = e.manager_id
    WHERE e.company_id = ${companyId} AND ${inScope(scope)}
      AND ${opt(f.departmentId, sql`e.department_id = ${f.departmentId ?? null}::uuid`)}
      AND ${opt(f.status, sql`e.status::text IN (${list(f.status ?? [])})`)}
    ORDER BY e.employee_code, e.id
    LIMIT ${f.limit} OFFSET ${f.offset}`);
}

// Attendance ------------------------------------------------------------------------------------------------------

export type AttendanceRow = EmployeeColumns & {
  present: number;
  short_hours: number;
  missed_core: number;
  missing_punch: number;
  absent: number;
  on_leave: number;
  holiday: number;
  weekend: number;
  worked_minutes: number;
  late_minutes: number;
  early_leave_minutes: number;
  needs_review: number;
  total_items: string;
};

/** Daily attendance records summarised per employee over the range (FR-ATT-011). */
export function attendance(
  db: Queryable,
  companyId: string,
  scope: RequestScope,
  f: {
    from: string;
    to: string;
    departmentId?: string | undefined;
    employeeId?: string | undefined;
  } & Paging,
) {
  const days = (status: string) => sql`count(*) FILTER (WHERE r.status = ${status})::int`;
  return db.execute<AttendanceRow>(sql`
    SELECT ${employeeColumns},
      ${days('present')} AS present, ${days('short_hours')} AS short_hours, ${days('missed_core')} AS missed_core,
      ${days('missing_punch')} AS missing_punch, ${days('absent')} AS absent, ${days('on_leave')} AS on_leave,
      ${days('holiday')} AS holiday, ${days('weekend')} AS weekend,
      coalesce(sum(r.worked_minutes), 0)::int AS worked_minutes,
      coalesce(sum(r.late_minutes), 0)::int AS late_minutes,
      coalesce(sum(r.early_leave_minutes), 0)::int AS early_leave_minutes,
      count(*) FILTER (WHERE r.needs_review)::int AS needs_review,
      count(*) OVER () AS total_items
    FROM attendance_records r
    JOIN employees e ON e.id = r.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    WHERE r.company_id = ${companyId} AND r.work_date BETWEEN ${f.from}::date AND ${f.to}::date
      AND ${inScope(scope)}
      AND ${opt(f.departmentId, sql`e.department_id = ${f.departmentId ?? null}::uuid`)}
      AND ${opt(f.employeeId, sql`e.id = ${f.employeeId ?? null}::uuid`)}
    GROUP BY e.id, d.name
    ORDER BY e.employee_code, e.id
    LIMIT ${f.limit} OFFSET ${f.offset}`);
}

// Leave -----------------------------------------------------------------------------------------------------------

export type LeaveRow = EmployeeColumns & {
  leave_type_id: string;
  leave_type_code: string;
  leave_type_name: string;
  entitled: string;
  used: string;
  reserved: string;
  adjusted: string;
  available: string;
  taken_in_period: string;
  total_items: string;
};

/** Leave statuses that count as taken: approved, including approved leave awaiting a cancellation decision. */
const TAKEN = sql`('approved', 'cancellation_pending')`;

/**
 * One row per employee and leave type: the balance for `year` and the units of approved leave that start inside
 * `from`..`to`. Rows come from balances of that year and from requests in the period.
 */
export function leave(
  db: Queryable,
  companyId: string,
  scope: RequestScope,
  f: {
    year: number;
    from: string;
    to: string;
    leaveTypeId?: string | undefined;
    departmentId?: string | undefined;
  } & Paging,
) {
  const qty = (column: SQL) => sql`coalesce(${column}, 0)::numeric(6, 2)::text`;
  return db.execute<LeaveRow>(sql`
    WITH keys AS (
      SELECT employee_id, leave_type_id FROM leave_balances WHERE company_id = ${companyId} AND leave_year = ${f.year}
      UNION
      SELECT employee_id, leave_type_id FROM leave_requests
      WHERE company_id = ${companyId} AND status IN ${TAKEN}
        AND start_date BETWEEN ${f.from}::date AND ${f.to}::date
    )
    SELECT ${employeeColumns}, lt.id AS leave_type_id, lt.code AS leave_type_code, lt.name AS leave_type_name,
      ${qty(sql`b.entitled`)} AS entitled, ${qty(sql`b.used`)} AS used, ${qty(sql`b.reserved`)} AS reserved,
      ${qty(sql`b.adjusted`)} AS adjusted, ${qty(sql`b.available`)} AS available,
      ${qty(sql`t.taken`)} AS taken_in_period,
      count(*) OVER () AS total_items
    FROM keys k
    JOIN employees e ON e.id = k.employee_id
    JOIN leave_types lt ON lt.id = k.leave_type_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN leave_balances b
      ON b.employee_id = k.employee_id AND b.leave_type_id = k.leave_type_id AND b.leave_year = ${f.year}
    LEFT JOIN LATERAL (
      SELECT sum(r.requested_units) AS taken FROM leave_requests r
      WHERE r.employee_id = k.employee_id AND r.leave_type_id = k.leave_type_id AND r.status IN ${TAKEN}
        AND r.start_date BETWEEN ${f.from}::date AND ${f.to}::date
    ) t ON true
    WHERE e.company_id = ${companyId} AND ${inScope(scope)}
      AND ${opt(f.leaveTypeId, sql`lt.id = ${f.leaveTypeId ?? null}::uuid`)}
      AND ${opt(f.departmentId, sql`e.department_id = ${f.departmentId ?? null}::uuid`)}
    ORDER BY e.employee_code, lt.sort_order, lt.code, e.id
    LIMIT ${f.limit} OFFSET ${f.offset}`);
}

// Payroll ---------------------------------------------------------------------------------------------------------

export type RunRow = {
  id: string;
  run_number: string;
  status: string;
  period_year: number;
  period_month: number;
};

export async function findRun(db: Queryable, companyId: string, runId: string) {
  const [row] = await db.execute<RunRow>(sql`
    SELECT r.id, r.run_number, r.status::text AS status, p.year::int AS period_year, p.month::int AS period_month
    FROM payroll_runs r JOIN payroll_periods p ON p.id = r.payroll_period_id
    WHERE r.company_id = ${companyId} AND r.id = ${runId}`);
  return row ?? null;
}

export type RunTotalsRow = {
  employee_count: number;
  gross: string;
  deductions: string;
  net: string;
  paid: string;
};

/** Totals over every item of a run (not only the page), with the sum of valid payments (FR-PAY-015). */
export async function runTotals(db: Queryable, runId: string) {
  const [row] = await db.execute<RunTotalsRow>(sql`
    SELECT count(*)::int AS employee_count, ${money(sql`sum(i.gross_amount)`)} AS gross,
      ${money(sql`sum(i.deduction_amount)`)} AS deductions, ${money(sql`sum(i.net_amount)`)} AS net,
      ${money(sql`(SELECT sum(pp.amount) FROM payroll_payments pp JOIN payroll_items pi ON pi.id = pp.payroll_item_id
        WHERE pi.payroll_run_id = ${runId} AND pp.status = 'paid')`)} AS paid
    FROM payroll_items i WHERE i.payroll_run_id = ${runId}`);
  return row as RunTotalsRow;
}

export type RegisterRow = EmployeeColumns & {
  payroll_item_id: string;
  days_in_period: number;
  days_employed: number;
  gross: string;
  deductions: string;
  net: string;
  reimbursements: string;
  payment_status: string;
  validation_flags: string[];
  total_items: string;
};

export function payrollRegister(db: Queryable, runId: string, page: Paging) {
  return db.execute<RegisterRow>(sql`
    SELECT ${employeeColumns}, i.id AS payroll_item_id, i.days_in_period::int AS days_in_period,
      i.days_employed::int AS days_employed, ${money(sql`i.gross_amount`)} AS gross,
      ${money(sql`i.deduction_amount`)} AS deductions, ${money(sql`i.net_amount`)} AS net,
      ${money(sql`(SELECT sum(l.amount) FROM payroll_line_items l
        WHERE l.payroll_item_id = i.id AND l.code = 'reimbursement')`)} AS reimbursements,
      i.payment_status, to_jsonb(i.validation_flags) AS validation_flags,
      count(*) OVER () AS total_items
    FROM payroll_items i
    JOIN employees e ON e.id = i.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    WHERE i.payroll_run_id = ${runId}
    ORDER BY e.employee_code, i.id
    LIMIT ${page.limit} OFFSET ${page.offset}`);
}

export type DeductionRow = EmployeeColumns & {
  run_id: string;
  run_number: string;
  period_year: number;
  period_month: number;
  code: string;
  label: string;
  amount: string;
  total_items: string;
  total_amount: string;
};

/** Run statuses that count towards a year's deductions: approved or later, so drafts never mix in. */
const FINAL_RUN = sql`('approved', 'locked', 'paid', 'reconciled')`;

export function payrollDeductions(
  db: Queryable,
  companyId: string,
  f: { runId?: string | undefined; year?: number | undefined } & Paging,
) {
  const which = f.runId
    ? sql`r.id = ${f.runId}::uuid`
    : sql`p.year = ${f.year ?? 0} AND r.status IN ${FINAL_RUN}`;
  return db.execute<DeductionRow>(sql`
    SELECT ${employeeColumns}, r.id AS run_id, r.run_number, p.year::int AS period_year,
      p.month::int AS period_month, l.code::text AS code, l.label, ${money(sql`l.amount`)} AS amount,
      count(*) OVER () AS total_items, ${money(sql`sum(l.amount) OVER ()`)} AS total_amount
    FROM payroll_line_items l
    JOIN payroll_items i ON i.id = l.payroll_item_id
    JOIN payroll_runs r ON r.id = i.payroll_run_id
    JOIN payroll_periods p ON p.id = r.payroll_period_id
    JOIN employees e ON e.id = i.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    WHERE i.company_id = ${companyId} AND l.kind = 'deduction' AND ${which}
    ORDER BY p.year, p.month, r.run_number, e.employee_code, l.sort_order, l.id
    LIMIT ${f.limit} OFFSET ${f.offset}`);
}

export type ReconciliationRow = EmployeeColumns & {
  payroll_item_id: string;
  gross: string;
  deductions: string;
  net: string;
  paid: string;
  difference: string;
  payment_count: number;
  methods: string[];
  last_paid_on: string | null;
  payment_status: string;
  total_items: string;
};

/** Net pay against valid (`paid`) payments per item (FR-PAY-015); cancelled payments do not count. */
export function paymentReconciliation(db: Queryable, runId: string, page: Paging) {
  return db.execute<ReconciliationRow>(sql`
    SELECT ${employeeColumns}, i.id AS payroll_item_id, ${money(sql`i.gross_amount`)} AS gross,
      ${money(sql`i.deduction_amount`)} AS deductions, ${money(sql`i.net_amount`)} AS net,
      ${money(sql`pay.paid`)} AS paid, ${money(sql`i.net_amount - coalesce(pay.paid, 0)`)} AS difference,
      coalesce(pay.n, 0)::int AS payment_count, coalesce(pay.methods, '[]'::jsonb) AS methods,
      pay.last_paid_on, i.payment_status, count(*) OVER () AS total_items
    FROM payroll_items i
    JOIN employees e ON e.id = i.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN LATERAL (
      SELECT sum(pp.amount) AS paid, count(*) AS n,
        to_jsonb(array_agg(DISTINCT pp.method::text ORDER BY pp.method::text)) AS methods,
        max(pp.paid_on)::text AS last_paid_on
      FROM payroll_payments pp WHERE pp.payroll_item_id = i.id AND pp.status = 'paid'
    ) pay ON true
    WHERE i.payroll_run_id = ${runId}
    ORDER BY e.employee_code, i.id
    LIMIT ${page.limit} OFFSET ${page.offset}`);
}

// Reimbursements --------------------------------------------------------------------------------------------------

export type ReimbursementRow = EmployeeColumns & {
  claim_id: string;
  claim_number: string;
  category: string;
  expense_date: string;
  amount: string;
  status: string;
  submitted_at: string | null;
  decided_at: string | null;
  run_number: string | null;
  total_items: string;
  total_amount: string;
};

/** Claims by expense date; drafts are the employee's own work in progress and never appear. */
export function reimbursements(
  db: Queryable,
  companyId: string,
  f: { from: string; to: string; status?: string[] | undefined } & Paging,
) {
  return db.execute<ReimbursementRow>(sql`
    SELECT ${employeeColumns}, c.id AS claim_id, c.claim_number, c.category, c.expense_date::text AS expense_date,
      ${money(sql`c.amount`)} AS amount, c.status, ${isoTimestamp(sql`c.submitted_at`)} AS submitted_at,
      ${isoTimestamp(sql`c.decided_at`)} AS decided_at, r.run_number,
      count(*) OVER () AS total_items, ${money(sql`sum(c.amount) OVER ()`)} AS total_amount
    FROM reimbursement_claims c
    JOIN employees e ON e.id = c.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN payroll_items i ON i.id = c.payroll_item_id
    LEFT JOIN payroll_runs r ON r.id = i.payroll_run_id
    WHERE c.company_id = ${companyId} AND c.status <> 'draft'
      AND c.expense_date BETWEEN ${f.from}::date AND ${f.to}::date
      AND ${opt(f.status, sql`c.status IN (${list(f.status ?? [])})`)}
    ORDER BY c.expense_date, c.claim_number, c.id
    LIMIT ${f.limit} OFFSET ${f.offset}`);
}
