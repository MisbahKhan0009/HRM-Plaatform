import { type Queryable, type RequestScope, schema, type Tx } from '@hrm/db';
import { BUSINESS_TZ } from '@hrm/domain';
import { and, asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

const {
  salaryStructures,
  payrollPeriods,
  payrollRuns,
  payrollItems,
  payrollLineItems,
  payrollAdjustments,
  payrollPayments,
  payslips,
  employees,
  employmentEvents,
  approvalRequests,
  companies,
} = schema;

/**
 * Restricts an employee-id column to the request scope. `whereEmployeeInScope` from `@hrm/db` binds the id list as one
 * array parameter, which postgres-js sends as a scalar when `fetch_types` is off; `IN (...)` binds each id instead.
 */
function inScope(column: AnyPgColumn, scope: RequestScope): SQL | undefined {
  if (scope.employees === 'all') return undefined;
  if (scope.employees.length === 0) return sql`false`;
  return inArray(column, [...scope.employees]);
}

const bump = <T extends { version: unknown }>(t: T) => sql`${t.version} + 1`;
const employeeName = sql<string>`coalesce(${employees.preferredName}, ${employees.firstName}) || ' ' || ${employees.lastName}`;
const employeeRef = { employeeCode: employees.employeeCode, employeeName };

async function count(
  db: Queryable,
  from: Parameters<ReturnType<Queryable['select']>['from']>[0],
  where: SQL | undefined,
) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(from).where(where);
  return row?.n ?? 0;
}

export async function employeeInCompany(db: Queryable, companyId: string, id: string) {
  const [row] = await db
    .select({ id: employees.id, userId: employees.userId })
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.id, id)));
  return row ?? null;
}

// Salary structures --------------------------------------------------------------------------------------------------

export type StructureRow = typeof salaryStructures.$inferSelect;
export type StructureView = { structure: StructureRow; employeeCode: string; employeeName: string };

function selectStructures(db: Queryable) {
  return db
    .select({ structure: salaryStructures, ...employeeRef })
    .from(salaryStructures)
    .innerJoin(employees, eq(employees.id, salaryStructures.employeeId));
}

export async function listStructures(
  db: Queryable,
  scope: RequestScope,
  filters: { employeeId?: string; approvedOnly: boolean },
  limit: number,
  offset: number,
) {
  const where = and(
    eq(salaryStructures.companyId, scope.companyId),
    inScope(salaryStructures.employeeId, scope),
    filters.employeeId ? eq(salaryStructures.employeeId, filters.employeeId) : undefined,
    filters.approvedOnly ? inArray(salaryStructures.status, ['approved', 'superseded']) : undefined,
  );
  const [rows, total] = await Promise.all([
    selectStructures(db)
      .where(where)
      .orderBy(asc(employees.employeeCode), desc(salaryStructures.effectiveFrom), desc(salaryStructures.id))
      .limit(limit)
      .offset(offset),
    count(db, salaryStructures, where),
  ]);
  return { rows, total };
}

export async function findStructure(
  db: Queryable,
  companyId: string,
  id: string,
): Promise<StructureView | null> {
  const [row] = await selectStructures(db).where(
    and(eq(salaryStructures.companyId, companyId), eq(salaryStructures.id, id)),
  );
  return row ?? null;
}

export async function lockStructure(tx: Tx, companyId: string, id: string) {
  const [row] = await tx
    .select()
    .from(salaryStructures)
    .where(and(eq(salaryStructures.companyId, companyId), eq(salaryStructures.id, id)))
    .for('update');
  return row ?? null;
}

/** The employee's approved structures, locked, so two approvals for one employee serialize. */
export function lockApprovedStructures(tx: Tx, companyId: string, employeeId: string) {
  return tx
    .select()
    .from(salaryStructures)
    .where(
      and(
        eq(salaryStructures.companyId, companyId),
        eq(salaryStructures.employeeId, employeeId),
        eq(salaryStructures.status, 'approved'),
      ),
    )
    .orderBy(asc(salaryStructures.effectiveFrom))
    .for('update');
}

export async function insertStructure(tx: Tx, values: typeof salaryStructures.$inferInsert) {
  await tx.insert(salaryStructures).values(values);
}

export async function updateStructure(
  tx: Tx,
  id: string,
  values: Partial<typeof salaryStructures.$inferInsert>,
  version?: number,
) {
  const [row] = await tx
    .update(salaryStructures)
    .set({ ...values, version: bump(salaryStructures) })
    .where(and(eq(salaryStructures.id, id), version ? eq(salaryStructures.version, version) : undefined))
    .returning();
  return row ?? null;
}

export async function insertEmploymentEvent(tx: Tx, values: typeof employmentEvents.$inferInsert) {
  await tx.insert(employmentEvents).values(values);
}

// Periods ------------------------------------------------------------------------------------------------------------

export type PeriodRow = typeof payrollPeriods.$inferSelect;

export async function listPeriods(
  db: Queryable,
  companyId: string,
  year: number | undefined,
  limit: number,
  offset: number,
) {
  const where = and(
    eq(payrollPeriods.companyId, companyId),
    year ? eq(payrollPeriods.year, year) : undefined,
  );
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(payrollPeriods)
      .where(where)
      .orderBy(desc(payrollPeriods.year), desc(payrollPeriods.month))
      .limit(limit)
      .offset(offset),
    count(db, payrollPeriods, where),
  ]);
  return { rows, total };
}

export async function findPeriod(db: Queryable, companyId: string, id: string) {
  const [row] = await db
    .select()
    .from(payrollPeriods)
    .where(and(eq(payrollPeriods.companyId, companyId), eq(payrollPeriods.id, id)));
  return row ?? null;
}

export async function lockPeriod(tx: Tx, companyId: string, id: string) {
  const [row] = await tx
    .select()
    .from(payrollPeriods)
    .where(and(eq(payrollPeriods.companyId, companyId), eq(payrollPeriods.id, id)))
    .for('update');
  return row ?? null;
}

export async function insertPeriod(tx: Tx, values: typeof payrollPeriods.$inferInsert) {
  const [row] = await tx.insert(payrollPeriods).values(values).returning();
  return row as PeriodRow;
}

export async function closePeriod(tx: Tx, id: string, by: string, now: Date) {
  await tx
    .update(payrollPeriods)
    .set({ status: 'closed', updatedAt: now, updatedBy: by, version: bump(payrollPeriods) })
    .where(eq(payrollPeriods.id, id));
}

// Runs ---------------------------------------------------------------------------------------------------------------

export type RunRow = typeof payrollRuns.$inferSelect;
export type RunView = { run: RunRow; period: PeriodRow };

function selectRuns(db: Queryable) {
  return db
    .select({ run: payrollRuns, period: payrollPeriods })
    .from(payrollRuns)
    .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.payrollPeriodId));
}

export async function listRuns(
  db: Queryable,
  companyId: string,
  filters: { periodId?: string; status?: string[] },
  limit: number,
  offset: number,
) {
  const where = and(
    eq(payrollRuns.companyId, companyId),
    filters.periodId ? eq(payrollRuns.payrollPeriodId, filters.periodId) : undefined,
    filters.status ? inArray(payrollRuns.status, filters.status as RunRow['status'][]) : undefined,
  );
  const [rows, total] = await Promise.all([
    selectRuns(db)
      .where(where)
      .orderBy(desc(payrollPeriods.year), desc(payrollPeriods.month), desc(payrollRuns.runNumber))
      .limit(limit)
      .offset(offset),
    count(db, payrollRuns, where),
  ]);
  return { rows, total };
}

export async function findRun(db: Queryable, companyId: string, id: string): Promise<RunView | null> {
  const [row] = await selectRuns(db).where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.id, id)));
  return row ?? null;
}

/** Locks the run row: concurrent commands on one run serialize (FR-PAY-019, PAY-08). */
export async function lockRun(tx: Tx, companyId: string, id: string): Promise<RunView | null> {
  const [row] = await selectRuns(tx)
    .where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.id, id)))
    .for('update', { of: payrollRuns });
  return row ?? null;
}

export async function countRunsInPeriod(tx: Tx, periodId: string) {
  return count(tx, payrollRuns, eq(payrollRuns.payrollPeriodId, periodId));
}

export async function insertRun(tx: Tx, values: typeof payrollRuns.$inferInsert) {
  await tx.insert(payrollRuns).values(values);
}

export async function updateRun(
  tx: Tx,
  id: string,
  version: number,
  values: Partial<typeof payrollRuns.$inferInsert>,
) {
  const [row] = await tx
    .update(payrollRuns)
    .set({ ...values, version: bump(payrollRuns) })
    .where(and(eq(payrollRuns.id, id), eq(payrollRuns.version, version)))
    .returning();
  return row ?? null;
}

/** Recomputes the run totals in SQL from its items (BUSINESS-RULES 6.5: totals are sums of items). */
export async function refreshRunTotals(tx: Tx, id: string) {
  await tx.execute(sql`
    UPDATE payroll_runs r SET total_gross = s.gross, total_deductions = s.deductions, total_net = s.net,
      employee_count = s.n
    FROM (SELECT coalesce(sum(gross_amount), 0) AS gross, coalesce(sum(deduction_amount), 0) AS deductions,
            coalesce(sum(net_amount), 0) AS net, count(*)::int AS n
          FROM payroll_items WHERE payroll_run_id = ${id}) s
    WHERE r.id = ${id}`);
}

export async function validationSummary(db: Queryable, runId: string) {
  const rows = await db.execute<{ flag: string; n: number }>(sql`
    SELECT f AS flag, count(*)::int AS n FROM payroll_items, unnest(validation_flags) AS f
    WHERE payroll_run_id = ${runId} GROUP BY f`);
  const [items] = await db.execute<{ blocking: number; warning: number }>(sql`
    SELECT
      count(*) FILTER (WHERE validation_flags && ARRAY['no_salary_structure','negative_net','currency_mismatch'])::int AS blocking,
      count(*) FILTER (WHERE cardinality(validation_flags) > 0
        AND NOT validation_flags && ARRAY['no_salary_structure','negative_net','currency_mismatch'])::int AS warning
    FROM payroll_items WHERE payroll_run_id = ${runId}`);
  return {
    byFlag: Object.fromEntries(rows.map((r) => [r.flag, r.n])) as Record<string, number>,
    blockingItems: items?.blocking ?? 0,
    warningItems: items?.warning ?? 0,
  };
}

/** Requester of the open approval for a payroll subject (D-007 self-approval check). */
export async function openApprovalRequester(
  db: Queryable,
  companyId: string,
  subject: { payrollRunId: string } | { payrollAdjustmentId: string },
) {
  const column =
    'payrollRunId' in subject ? approvalRequests.payrollRunId : approvalRequests.payrollAdjustmentId;
  const id = 'payrollRunId' in subject ? subject.payrollRunId : subject.payrollAdjustmentId;
  const [row] = await db
    .select({ requester: approvalRequests.requesterUserId })
    .from(approvalRequests)
    .where(
      and(eq(approvalRequests.companyId, companyId), eq(column, id), eq(approvalRequests.state, 'open')),
    );
  return row?.requester ?? null;
}

// Calculation inputs (BUSINESS-RULES 6.1–6.4) -------------------------------------------------------------------------

export type EligibleEmployee = {
  id: string;
  code: string;
  name: string;
  department: string | null;
  position: string | null;
  joining_date: string;
  separation_date: string | null;
};

/** BUSINESS-RULES 6.1: employed in the period and in an eligible status. */
export function eligibleEmployees(tx: Tx, companyId: string, start: string, end: string) {
  return tx.execute<EligibleEmployee>(sql`
    SELECT e.id, e.employee_code AS code, coalesce(e.preferred_name, e.first_name) || ' ' || e.last_name AS name,
      d.name AS department, p.title AS position, e.joining_date::text AS joining_date,
      e.separation_date::text AS separation_date
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN positions p ON p.id = e.position_id
    WHERE e.company_id = ${companyId}
      AND e.joining_date <= ${end}::date
      AND (e.separation_date IS NULL OR e.separation_date >= ${start}::date)
      AND (e.status IN ('probation', 'active', 'notice_period')
           OR (e.status = 'separated' AND e.separation_date BETWEEN ${start}::date AND ${end}::date))
    ORDER BY e.employee_code
    LIMIT 1000`);
}

export function approvedStructuresFor(tx: Tx, companyId: string, start: string, end: string) {
  return tx.execute<{
    id: string;
    employee_id: string;
    gross_amount: string;
    currency: string;
    effective_from: string;
    effective_to: string | null;
  }>(sql`
    SELECT id, employee_id, gross_amount::text, currency, effective_from::text, effective_to::text
    FROM salary_structures
    WHERE company_id = ${companyId} AND status = 'approved'
      AND effective_from <= ${end}::date AND (effective_to IS NULL OR effective_to >= ${start}::date)`);
}

/**
 * Approved claims decided on or before the period end and not yet included (BUSINESS-RULES 6.4, D-020). A claim that
 * already sits in another run being processed (calculated, submitted or approved) is left to that run.
 */
export function eligibleClaims(tx: Tx, companyId: string, runId: string, end: string) {
  return tx.execute<{
    id: string;
    employee_id: string;
    claim_number: string;
    expense_date: string;
    amount: string;
    currency: string;
  }>(sql`
    SELECT c.id, c.employee_id, c.claim_number, c.expense_date::text, c.amount::text, c.currency
    FROM reimbursement_claims c
    WHERE c.company_id = ${companyId} AND c.status = 'approved' AND c.payroll_item_id IS NULL
      AND (c.decided_at AT TIME ZONE ${BUSINESS_TZ})::date <= ${end}::date
      AND NOT EXISTS (
        SELECT 1 FROM payroll_line_items li
        JOIN payroll_items pi ON pi.id = li.payroll_item_id
        JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
        WHERE li.source_type = 'reimbursement_claim' AND li.source_id = c.id
          AND pr.id <> ${runId} AND pr.status IN ('calculated', 'submitted', 'approved'))`);
}

export function eligibleAdjustments(tx: Tx, companyId: string, periodId: string) {
  return tx.execute<{
    id: string;
    employee_id: string;
    type: 'addition' | 'deduction';
    line_code: 'addition' | 'deduction' | 'arrears';
    amount: string;
    reason: string;
  }>(sql`
    SELECT id, employee_id, type, line_code, amount::text, reason FROM payroll_adjustments
    WHERE company_id = ${companyId} AND target_period_id = ${periodId} AND status = 'approved'
      AND applied_payroll_item_id IS NULL
    ORDER BY created_at, id`);
}

/** Net of each employee's item in their latest locked regular run before the period (BUSINESS-RULES 6.5, PAY-13d). */
export function previousNets(db: Queryable, companyId: string, start: string) {
  return db.execute<{ employee_id: string; net: string }>(sql`
    SELECT DISTINCT ON (pi.employee_id) pi.employee_id, pi.net_amount::text AS net
    FROM payroll_items pi
    JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
    JOIN payroll_periods pp ON pp.id = pr.payroll_period_id
    WHERE pr.company_id = ${companyId} AND pr.run_type = 'regular'
      AND pr.status IN ('locked', 'paid', 'reconciled') AND pp.end_date < ${start}::date
    ORDER BY pi.employee_id, pp.end_date DESC`);
}

export async function deleteRunItems(tx: Tx, runId: string) {
  await tx.execute(sql`
    DELETE FROM payroll_line_items WHERE payroll_item_id IN (SELECT id FROM payroll_items WHERE payroll_run_id = ${runId})`);
  await tx.delete(payrollItems).where(eq(payrollItems.payrollRunId, runId));
}

export async function insertItems(tx: Tx, rows: (typeof payrollItems.$inferInsert)[]) {
  if (rows.length) await tx.insert(payrollItems).values(rows);
}

export async function insertLines(tx: Tx, rows: (typeof payrollLineItems.$inferInsert)[]) {
  for (let i = 0; i < rows.length; i += 500) await tx.insert(payrollLineItems).values(rows.slice(i, i + 500));
}

// Items --------------------------------------------------------------------------------------------------------------

export type ItemRow = typeof payrollItems.$inferSelect;
export type ItemView = { item: ItemRow; employeeCode: string; employeeName: string };

function selectItems(db: Queryable) {
  return db
    .select({ item: payrollItems, ...employeeRef })
    .from(payrollItems)
    .innerJoin(employees, eq(employees.id, payrollItems.employeeId));
}

export async function listItems(
  db: Queryable,
  runId: string,
  filters: { employeeId?: string; flag?: string },
  limit: number,
  offset: number,
) {
  const where = and(
    eq(payrollItems.payrollRunId, runId),
    filters.employeeId ? eq(payrollItems.employeeId, filters.employeeId) : undefined,
    filters.flag ? sql`${filters.flag} = ANY(${payrollItems.validationFlags})` : undefined,
  );
  const [rows, total] = await Promise.all([
    selectItems(db)
      .where(where)
      .orderBy(asc(employees.employeeCode), asc(payrollItems.id))
      .limit(limit)
      .offset(offset),
    count(db, payrollItems, where),
  ]);
  return { rows, total };
}

/** All items of a run (at most one per employee; 50 employees in v1). */
export function allItems(db: Queryable, runId: string) {
  return selectItems(db)
    .where(eq(payrollItems.payrollRunId, runId))
    .orderBy(asc(employees.employeeCode))
    .limit(2000);
}

export async function findItem(db: Queryable, runId: string, itemId: string): Promise<ItemView | null> {
  const [row] = await selectItems(db).where(
    and(eq(payrollItems.payrollRunId, runId), eq(payrollItems.id, itemId)),
  );
  return row ?? null;
}

export function itemLines(db: Queryable, itemId: string) {
  return db
    .select()
    .from(payrollLineItems)
    .where(eq(payrollLineItems.payrollItemId, itemId))
    .orderBy(asc(payrollLineItems.sortOrder));
}

export async function setItemFlags(tx: Tx, flags: { id: string; flags: string[] }[]) {
  if (!flags.length) return;
  await tx.execute(sql`
    UPDATE payroll_items i SET validation_flags = v.flags
    FROM (SELECT * FROM jsonb_to_recordset(${JSON.stringify(flags)}::jsonb) AS x(id uuid, flags text[])) v
    WHERE i.id = v.id`);
}

/** Locks an item of the run for a payment change. */
export async function lockItem(tx: Tx, runId: string, itemId: string): Promise<ItemView | null> {
  const [row] = await selectItems(tx)
    .where(and(eq(payrollItems.payrollRunId, runId), eq(payrollItems.id, itemId)))
    .for('update', { of: payrollItems });
  return row ?? null;
}

export async function setItemPaymentStatus(tx: Tx, itemId: string, status: string, by: string, now: Date) {
  await tx
    .update(payrollItems)
    .set({ paymentStatus: status, updatedAt: now, updatedBy: by, version: bump(payrollItems) })
    .where(eq(payrollItems.id, itemId));
}

/** Items that still need a payment: net above zero and not paid (DOMAIN-MODEL 5.6 `paid`). */
export async function unpaidItems(db: Queryable, runId: string) {
  return db
    .select({ id: payrollItems.id, status: payrollItems.paymentStatus })
    .from(payrollItems)
    .where(
      and(
        eq(payrollItems.payrollRunId, runId),
        sql`${payrollItems.netAmount} > 0`,
        sql`${payrollItems.paymentStatus} <> 'paid'`,
      ),
    )
    .limit(2000);
}

// Lock side effects (BUSINESS-RULES 6.8) -------------------------------------------------------------------------------

export function lineSourceCount(
  tx: Tx,
  runId: string,
  sourceType: 'reimbursement_claim' | 'payroll_adjustment',
) {
  return tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM payroll_line_items li JOIN payroll_items pi ON pi.id = li.payroll_item_id
    WHERE pi.payroll_run_id = ${runId} AND li.source_type = ${sourceType}`);
}

export function includeClaims(tx: Tx, runId: string, by: string, now: Date) {
  return tx.execute<{ id: string; employee_id: string }>(sql`
    UPDATE reimbursement_claims c SET status = 'included', payroll_item_id = li.payroll_item_id,
      updated_at = ${now.toISOString()}::timestamptz, updated_by = ${by}, version = c.version + 1
    FROM payroll_line_items li JOIN payroll_items pi ON pi.id = li.payroll_item_id
    WHERE pi.payroll_run_id = ${runId} AND li.source_type = 'reimbursement_claim' AND li.source_id = c.id
      AND c.status = 'approved' AND c.payroll_item_id IS NULL
    RETURNING c.id, c.employee_id`);
}

export function applyAdjustments(tx: Tx, runId: string, by: string, now: Date) {
  return tx.execute<{ id: string; employee_id: string; applied_payroll_item_id: string }>(sql`
    UPDATE payroll_adjustments a SET status = 'applied', applied_payroll_item_id = li.payroll_item_id,
      updated_at = ${now.toISOString()}::timestamptz, updated_by = ${by}, version = a.version + 1
    FROM payroll_line_items li JOIN payroll_items pi ON pi.id = li.payroll_item_id
    WHERE pi.payroll_run_id = ${runId} AND li.source_type = 'payroll_adjustment' AND li.source_id = a.id
      AND a.status = 'approved' AND a.applied_payroll_item_id IS NULL
    RETURNING a.id, a.employee_id, a.applied_payroll_item_id`);
}

export function payClaims(tx: Tx, runId: string, by: string, now: Date) {
  return tx.execute<{ id: string }>(sql`
    UPDATE reimbursement_claims c SET status = 'paid', updated_at = ${now.toISOString()}::timestamptz, updated_by = ${by}, version = c.version + 1
    FROM payroll_items pi
    WHERE pi.payroll_run_id = ${runId} AND c.payroll_item_id = pi.id AND c.status = 'included'
    RETURNING c.id`);
}

// Payments -----------------------------------------------------------------------------------------------------------

export type PaymentRow = typeof payrollPayments.$inferSelect;
export type PaymentView = {
  payment: PaymentRow;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
};

function selectPayments(db: Queryable) {
  return db
    .select({ payment: payrollPayments, employeeId: payrollItems.employeeId, ...employeeRef })
    .from(payrollPayments)
    .innerJoin(payrollItems, eq(payrollItems.id, payrollPayments.payrollItemId))
    .innerJoin(employees, eq(employees.id, payrollItems.employeeId));
}

export async function insertPayment(tx: Tx, values: typeof payrollPayments.$inferInsert) {
  await tx.insert(payrollPayments).values(values);
}

export async function findPayment(db: Queryable, companyId: string, id: string): Promise<PaymentView | null> {
  const [row] = await selectPayments(db).where(
    and(eq(payrollPayments.companyId, companyId), eq(payrollPayments.id, id)),
  );
  return row ?? null;
}

export async function lockPayment(tx: Tx, companyId: string, id: string) {
  const [row] = await tx
    .select({ payment: payrollPayments, runId: payrollItems.payrollRunId })
    .from(payrollPayments)
    .innerJoin(payrollItems, eq(payrollItems.id, payrollPayments.payrollItemId))
    .where(and(eq(payrollPayments.companyId, companyId), eq(payrollPayments.id, id)))
    .for('update', { of: payrollPayments });
  return row ?? null;
}

export async function updatePayment(
  tx: Tx,
  id: string,
  values: Partial<typeof payrollPayments.$inferInsert>,
) {
  await tx
    .update(payrollPayments)
    .set({ ...values, version: bump(payrollPayments) })
    .where(eq(payrollPayments.id, id));
}

/** Items of the run keyed by employee code, for the CSV import. */
export function itemsByEmployeeCode(db: Queryable, runId: string, codes: string[]) {
  if (!codes.length) return Promise.resolve([]);
  return db
    .select({
      id: payrollItems.id,
      employeeCode: employees.employeeCode,
      netAmount: payrollItems.netAmount,
      paymentStatus: payrollItems.paymentStatus,
    })
    .from(payrollItems)
    .innerJoin(employees, eq(employees.id, payrollItems.employeeId))
    .where(and(eq(payrollItems.payrollRunId, runId), inArray(employees.employeeCode, codes)));
}

export async function chequeNumbersInUse(db: Queryable, companyId: string, numbers: string[]) {
  if (!numbers.length) return new Set<string>();
  const rows = await db
    .select({ n: payrollPayments.chequeNumber })
    .from(payrollPayments)
    .where(
      and(
        eq(payrollPayments.companyId, companyId),
        inArray(payrollPayments.chequeNumber, numbers),
        sql`${payrollPayments.status} <> 'cancelled'`,
      ),
    );
  return new Set(rows.map((r) => r.n as string));
}

/** Per-item reconciliation in SQL (FR-PAY-015): net vs the sum of `paid` payments, with failed/cancelled counts. */
export function reconciliation(db: Queryable, runId: string) {
  return db.execute<{
    id: string;
    employee_id: string;
    code: string;
    name: string;
    gross: string;
    deductions: string;
    net: string;
    paid: string;
    payment_status: string;
    failed: number;
    cancelled: number;
  }>(sql`
    SELECT pi.id, pi.employee_id, e.employee_code AS code,
      coalesce(e.preferred_name, e.first_name) || ' ' || e.last_name AS name,
      pi.gross_amount::text AS gross, pi.deduction_amount::text AS deductions, pi.net_amount::text AS net,
      coalesce(sum(pp.amount) FILTER (WHERE pp.status = 'paid'), 0)::text AS paid,
      pi.payment_status,
      count(pp.id) FILTER (WHERE pp.status = 'failed')::int AS failed,
      count(pp.id) FILTER (WHERE pp.status = 'cancelled')::int AS cancelled
    FROM payroll_items pi
    JOIN employees e ON e.id = pi.employee_id
    LEFT JOIN payroll_payments pp ON pp.payroll_item_id = pi.id
    WHERE pi.payroll_run_id = ${runId}
    GROUP BY pi.id, e.id
    ORDER BY e.employee_code
    LIMIT 2000`);
}

// Payslips -----------------------------------------------------------------------------------------------------------

/** Items of the run without a payslip yet, with the employee's active user for the email. */
export function itemsToPublish(tx: Tx, runId: string) {
  return tx.execute<{ id: string; employee_id: string; user_id: string | null }>(sql`
    SELECT pi.id, pi.employee_id, u.id AS user_id
    FROM payroll_items pi
    JOIN employees e ON e.id = pi.employee_id
    LEFT JOIN users u ON u.id = e.user_id AND u.status = 'active'
    WHERE pi.payroll_run_id = ${runId} AND NOT EXISTS (SELECT 1 FROM payslips p WHERE p.payroll_item_id = pi.id)`);
}

export async function insertPayslips(tx: Tx, rows: (typeof payslips.$inferInsert)[]) {
  if (rows.length) await tx.insert(payslips).values(rows);
}

const payslipColumns = {
  payslip: payslips,
  item: payrollItems,
  period: payrollPeriods,
  runNumber: payrollRuns.runNumber,
  ...employeeRef,
};

function selectPayslips(db: Queryable) {
  return db
    .select(payslipColumns)
    .from(payslips)
    .innerJoin(payrollItems, eq(payrollItems.id, payslips.payrollItemId))
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.payrollRunId))
    .innerJoin(payrollPeriods, eq(payrollPeriods.id, payslips.payrollPeriodId))
    .innerJoin(employees, eq(employees.id, payslips.employeeId));
}

export type PayslipView = {
  payslip: typeof payslips.$inferSelect;
  item: ItemRow;
  period: PeriodRow;
  runNumber: string;
  employeeCode: string;
  employeeName: string;
};

export async function listPayslips(
  db: Queryable,
  scope: RequestScope,
  filters: { employeeId?: string; periodId?: string; year?: number },
  limit: number,
  offset: number,
) {
  const where = and(
    eq(payslips.companyId, scope.companyId),
    inScope(payslips.employeeId, scope),
    filters.employeeId ? eq(payslips.employeeId, filters.employeeId) : undefined,
    filters.periodId ? eq(payslips.payrollPeriodId, filters.periodId) : undefined,
    filters.year ? eq(payrollPeriods.year, filters.year) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    selectPayslips(db)
      .where(where)
      .orderBy(
        desc(payrollPeriods.year),
        desc(payrollPeriods.month),
        asc(employees.employeeCode),
        asc(payslips.id),
      )
      .limit(limit)
      .offset(offset),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(payslips)
      .innerJoin(payrollPeriods, eq(payrollPeriods.id, payslips.payrollPeriodId))
      .where(where),
  ]);
  return { rows, total: total?.n ?? 0 };
}

export async function findPayslip(
  db: Queryable,
  scope: RequestScope,
  id: string,
): Promise<PayslipView | null> {
  const [row] = await selectPayslips(db).where(
    and(eq(payslips.companyId, scope.companyId), eq(payslips.id, id), inScope(payslips.employeeId, scope)),
  );
  return row ?? null;
}

/** Sets `first_viewed_at` once; returns true when this call set it. */
export async function markPayslipViewed(tx: Tx, id: string, now: Date) {
  const rows = await tx
    .update(payslips)
    .set({ firstViewedAt: now })
    .where(and(eq(payslips.id, id), sql`${payslips.firstViewedAt} IS NULL`))
    .returning({ id: payslips.id });
  return rows.length > 0;
}

export async function findCompany(db: Queryable, companyId: string) {
  const [row] = await db
    .select({ name: companies.name, legalName: companies.legalName, address: companies.address })
    .from(companies)
    .where(eq(companies.id, companyId));
  return row ?? null;
}

// Adjustments --------------------------------------------------------------------------------------------------------

export type AdjustmentRow = typeof payrollAdjustments.$inferSelect;
export type AdjustmentView = { adjustment: AdjustmentRow; employeeCode: string; employeeName: string };

function selectAdjustments(db: Queryable) {
  return db
    .select({ adjustment: payrollAdjustments, ...employeeRef })
    .from(payrollAdjustments)
    .innerJoin(employees, eq(employees.id, payrollAdjustments.employeeId));
}

export async function listAdjustments(
  db: Queryable,
  companyId: string,
  filters: { status?: string[]; employeeId?: string; periodId?: string },
  limit: number,
  offset: number,
) {
  const where = and(
    eq(payrollAdjustments.companyId, companyId),
    filters.status ? inArray(payrollAdjustments.status, filters.status) : undefined,
    filters.employeeId ? eq(payrollAdjustments.employeeId, filters.employeeId) : undefined,
    filters.periodId ? eq(payrollAdjustments.targetPeriodId, filters.periodId) : undefined,
  );
  const [rows, total] = await Promise.all([
    selectAdjustments(db)
      .where(where)
      .orderBy(desc(payrollAdjustments.createdAt), desc(payrollAdjustments.id))
      .limit(limit)
      .offset(offset),
    count(db, payrollAdjustments, where),
  ]);
  return { rows, total };
}

export async function findAdjustment(
  db: Queryable,
  companyId: string,
  id: string,
): Promise<AdjustmentView | null> {
  const [row] = await selectAdjustments(db).where(
    and(eq(payrollAdjustments.companyId, companyId), eq(payrollAdjustments.id, id)),
  );
  return row ?? null;
}

export async function lockAdjustment(tx: Tx, companyId: string, id: string) {
  const [row] = await tx
    .select()
    .from(payrollAdjustments)
    .where(and(eq(payrollAdjustments.companyId, companyId), eq(payrollAdjustments.id, id)))
    .for('update');
  return row ?? null;
}

export async function insertAdjustment(tx: Tx, values: typeof payrollAdjustments.$inferInsert) {
  await tx.insert(payrollAdjustments).values(values);
}

export async function updateAdjustment(
  tx: Tx,
  id: string,
  version: number,
  values: Partial<typeof payrollAdjustments.$inferInsert>,
) {
  const [row] = await tx
    .update(payrollAdjustments)
    .set({ ...values, version: bump(payrollAdjustments) })
    .where(and(eq(payrollAdjustments.id, id), eq(payrollAdjustments.version, version)))
    .returning();
  return row ?? null;
}

/** An item of a locked run for the same employee: what a correction adjustment may reference (FR-PAY-011). */
export async function lockedItemOf(db: Queryable, companyId: string, itemId: string, employeeId: string) {
  const [row] = await db
    .select({ id: payrollItems.id })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.payrollRunId))
    .where(
      and(
        eq(payrollItems.companyId, companyId),
        eq(payrollItems.id, itemId),
        eq(payrollItems.employeeId, employeeId),
        inArray(payrollRuns.status, ['locked', 'paid', 'reconciled']),
      ),
    );
  return Boolean(row);
}
