import type { BalancesQuery, LeaveRequestsQuery, LedgerQuery } from '@hrm/contracts';
import { type Queryable, type RequestScope, schema, type Tx, uuidv7 } from '@hrm/db';
import type { BalanceColumns, LedgerPosting } from '@hrm/domain';
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { type PageQuery, pageOffset } from '../../lib/pagination';

const {
  leaveTypes,
  leavePolicies,
  leaveRequests,
  leaveLedgerEntries,
  leaveBalances,
  employees,
  holidays,
  scheduleAssignments,
  workSchedules,
} = schema;

export type LeaveTypeRow = typeof leaveTypes.$inferSelect;
export type LeavePolicyRow = typeof leavePolicies.$inferSelect;
export type LeaveRequestRow = typeof leaveRequests.$inferSelect;

/**
 * Restricts an employee-id column to a scope. Uses `IN (...)` because `whereEmployeeInScope` from `@hrm/db` binds a
 * JS array, which postgres-js sends as text without type fetching (`malformed array literal`). Teams are small (≤ 50).
 */
function inEmployeeScope(column: AnyPgColumn, scope: RequestScope): SQL | undefined {
  if (scope.employees === 'all') return undefined;
  if (scope.employees.length === 0) return sql`false`;
  return inArray(column, [...scope.employees]);
}

const bump = <T extends { version: unknown }>(t: T) => sql`${t.version} + 1`;
const employeeName = sql<string>`coalesce(${employees.preferredName}, ${employees.firstName}) || ' ' || ${employees.lastName}`;

/** Policies in force on a date: `effective_from <= d <= coalesce(effective_to, d)`. */
const policyOn = (date: string) =>
  and(
    lte(leavePolicies.effectiveFrom, date),
    or(isNull(leavePolicies.effectiveTo), gte(leavePolicies.effectiveTo, date)),
  );

// Types and policies ------------------------------------------------------------------------------------------------

export function listTypesWithPolicy(
  db: Queryable,
  companyId: string,
  today: string,
  includeInactive: boolean,
) {
  return db
    .select({ type: leaveTypes, policy: leavePolicies })
    .from(leaveTypes)
    .leftJoin(leavePolicies, and(eq(leavePolicies.leaveTypeId, leaveTypes.id), policyOn(today)))
    .where(
      and(eq(leaveTypes.companyId, companyId), includeInactive ? undefined : eq(leaveTypes.isActive, true)),
    )
    .orderBy(asc(leaveTypes.sortOrder), asc(leaveTypes.code))
    .limit(100);
}

export async function findType(db: Queryable, companyId: string, id: string) {
  const [row] = await db
    .select()
    .from(leaveTypes)
    .where(and(eq(leaveTypes.companyId, companyId), eq(leaveTypes.id, id)));
  return row ?? null;
}

export async function insertType(tx: Tx, values: typeof leaveTypes.$inferInsert) {
  const [row] = await tx.insert(leaveTypes).values(values).returning();
  return row;
}

export async function updateType(
  tx: Tx,
  companyId: string,
  id: string,
  version: number,
  values: Partial<typeof leaveTypes.$inferInsert>,
) {
  const [row] = await tx
    .update(leaveTypes)
    .set({ ...values, version: bump(leaveTypes) })
    .where(and(eq(leaveTypes.companyId, companyId), eq(leaveTypes.id, id), eq(leaveTypes.version, version)))
    .returning();
  return row ?? null;
}

export function listPolicies(db: Queryable, companyId: string, leaveTypeId: string) {
  return db
    .select()
    .from(leavePolicies)
    .where(and(eq(leavePolicies.companyId, companyId), eq(leavePolicies.leaveTypeId, leaveTypeId)))
    .orderBy(desc(leavePolicies.effectiveFrom))
    .limit(100);
}

export async function policyOnDate(db: Queryable, companyId: string, leaveTypeId: string, date: string) {
  const [row] = await db
    .select()
    .from(leavePolicies)
    .where(
      and(eq(leavePolicies.companyId, companyId), eq(leavePolicies.leaveTypeId, leaveTypeId), policyOn(date)),
    );
  return row ?? null;
}

/** The policy governing a leave year: the one in force on its last day, else the latest one starting in it. */
export async function policyForYear(db: Queryable, companyId: string, leaveTypeId: string, year: number) {
  const [row] = await db
    .select()
    .from(leavePolicies)
    .where(
      and(
        eq(leavePolicies.companyId, companyId),
        eq(leavePolicies.leaveTypeId, leaveTypeId),
        lte(leavePolicies.effectiveFrom, `${year}-12-31`),
        or(isNull(leavePolicies.effectiveTo), gte(leavePolicies.effectiveTo, `${year}-01-01`)),
      ),
    )
    .orderBy(desc(leavePolicies.effectiveFrom))
    .limit(1);
  return row ?? null;
}

/** Ends the open-ended policy version the day before a new version starts (effective-dated, DATA-MODEL §6). */
export async function closeOpenPolicy(
  tx: Tx,
  companyId: string,
  leaveTypeId: string,
  from: string,
  by: string,
) {
  await tx
    .update(leavePolicies)
    .set({
      effectiveTo: sql`${from}::date - 1`,
      updatedBy: by,
      updatedAt: sql`now()`,
      version: bump(leavePolicies),
    })
    .where(
      and(
        eq(leavePolicies.companyId, companyId),
        eq(leavePolicies.leaveTypeId, leaveTypeId),
        isNull(leavePolicies.effectiveTo),
        sql`${leavePolicies.effectiveFrom} < ${from}`,
      ),
    );
}

export async function insertPolicy(tx: Tx, values: typeof leavePolicies.$inferInsert) {
  const [row] = await tx.insert(leavePolicies).values(values).returning();
  return row;
}

// Employees and calendars ---------------------------------------------------------------------------------------------

export async function findEmployee(db: Queryable, companyId: string, id: string) {
  const [row] = await db
    .select({
      id: employees.id,
      code: employees.employeeCode,
      name: employeeName,
      status: employees.status,
      joiningDate: employees.joiningDate,
      separationDate: employees.separationDate,
      userId: employees.userId,
      managerId: employees.managerId,
    })
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.id, id)));
  return row ?? null;
}

/** Schedules assigned to an employee overlapping a range, the company default, and holidays in the range. */
export async function workCalendar(
  db: Queryable,
  companyId: string,
  employeeId: string,
  from: string,
  to: string,
) {
  const [spans, defaults, hols] = await Promise.all([
    db
      .select({
        from: scheduleAssignments.effectiveFrom,
        to: scheduleAssignments.effectiveTo,
        workingDays: workSchedules.workingDays,
      })
      .from(scheduleAssignments)
      .innerJoin(workSchedules, eq(workSchedules.id, scheduleAssignments.workScheduleId))
      .where(
        and(
          eq(scheduleAssignments.companyId, companyId),
          eq(scheduleAssignments.employeeId, employeeId),
          lte(scheduleAssignments.effectiveFrom, to),
          or(isNull(scheduleAssignments.effectiveTo), gte(scheduleAssignments.effectiveTo, from)),
        ),
      ),
    db
      .select({ workingDays: workSchedules.workingDays })
      .from(workSchedules)
      .where(and(eq(workSchedules.companyId, companyId), eq(workSchedules.isDefault, true)))
      .limit(1),
    db
      .select({ date: holidays.date })
      .from(holidays)
      .where(and(eq(holidays.companyId, companyId), gte(holidays.date, from), lte(holidays.date, to))),
  ]);
  return {
    schedules: spans,
    defaultWorkingDays: defaults[0]?.workingDays ?? [0, 1, 2, 3, 4],
    holidays: hols.map((h) => h.date),
  };
}

// Requests ----------------------------------------------------------------------------------------------------------

const requestView = {
  request: leaveRequests,
  employeeCode: employees.employeeCode,
  employeeName,
  employeeUserId: employees.userId,
  leaveTypeCode: leaveTypes.code,
  leaveTypeName: leaveTypes.name,
};
export type LeaveRequestView = {
  request: LeaveRequestRow;
  employeeCode: string;
  employeeName: string;
  employeeUserId: string | null;
  leaveTypeCode: string;
  leaveTypeName: string;
};

function requestQuery(db: Queryable) {
  return db
    .select(requestView)
    .from(leaveRequests)
    .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId));
}

export async function findRequest(
  db: Queryable,
  scope: RequestScope,
  id: string,
): Promise<LeaveRequestView | null> {
  const [row] = await requestQuery(db).where(
    and(
      eq(leaveRequests.companyId, scope.companyId),
      eq(leaveRequests.id, id),
      inEmployeeScope(leaveRequests.employeeId, scope),
    ),
  );
  return row ?? null;
}

/** Locks the request row for a transition (MODULE-GUIDE §6: load with lock, check, write). */
export async function findRequestForUpdate(
  tx: Tx,
  scope: RequestScope,
  id: string,
): Promise<LeaveRequestView | null> {
  const [row] = await requestQuery(tx)
    .where(
      and(
        eq(leaveRequests.companyId, scope.companyId),
        eq(leaveRequests.id, id),
        inEmployeeScope(leaveRequests.employeeId, scope),
      ),
    )
    .for('update', { of: leaveRequests });
  return row ?? null;
}

export async function listRequests(db: Queryable, scope: RequestScope, q: LeaveRequestsQuery) {
  const where = and(
    eq(leaveRequests.companyId, scope.companyId),
    inEmployeeScope(leaveRequests.employeeId, scope),
    q.status ? inArray(leaveRequests.status, q.status) : undefined,
    q.employeeId ? eq(leaveRequests.employeeId, q.employeeId) : undefined,
    q.leaveTypeId ? eq(leaveRequests.leaveTypeId, q.leaveTypeId) : undefined,
    q.from ? gte(leaveRequests.endDate, q.from) : undefined,
    q.to ? lte(leaveRequests.startDate, q.to) : undefined,
  );
  const order: SQL[] = {
    startDate: [asc(leaveRequests.startDate)],
    '-startDate': [desc(leaveRequests.startDate)],
    requestNumber: [asc(leaveRequests.requestNumber)],
    '-requestNumber': [desc(leaveRequests.requestNumber)],
  }[q.sort];
  const [rows, total] = await Promise.all([
    requestQuery(db)
      .where(where)
      .orderBy(...order, asc(leaveRequests.id))
      .limit(q.pageSize)
      .offset(pageOffset(q)),
    db.select({ n: count() }).from(leaveRequests).where(where),
  ]);
  return { rows, total: total[0]?.n ?? 0 };
}

export async function insertRequest(tx: Tx, values: typeof leaveRequests.$inferInsert) {
  const [row] = await tx.insert(leaveRequests).values(values).returning({ id: leaveRequests.id });
  return row?.id as string;
}

export async function updateRequest(
  tx: Tx,
  id: string,
  version: number,
  values: Partial<typeof leaveRequests.$inferInsert>,
) {
  const [row] = await tx
    .update(leaveRequests)
    .set({ ...values, version: bump(leaveRequests) })
    .where(and(eq(leaveRequests.id, id), eq(leaveRequests.version, version)))
    .returning({ id: leaveRequests.id });
  return row?.id ?? null;
}

/**
 * Active requests (`pending`, `approved`, `cancellation_pending`) sharing a date with the slot, except a first and a
 * second half on the same date (BUSINESS-RULES 3.1).
 */
export async function hasOverlap(
  db: Queryable,
  employeeId: string,
  slot: { startDate: string; endDate: string; unit: 'day' | 'half_day'; halfDayPart: string | null },
) {
  const [row] = await db
    .select({ id: leaveRequests.id })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.employeeId, employeeId),
        inArray(leaveRequests.status, ['pending', 'approved', 'cancellation_pending']),
        lte(leaveRequests.startDate, slot.endDate),
        gte(leaveRequests.endDate, slot.startDate),
        slot.unit === 'half_day' && slot.halfDayPart
          ? sql`NOT (${leaveRequests.unit} = 'half_day' AND ${leaveRequests.halfDayPart} <> ${slot.halfDayPart})`
          : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Serialises request creation per employee, so overlap checks across leave types cannot race. */
export async function lockEmployeeLeave(tx: Tx, employeeId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`leave:${employeeId}`}, 0))`);
}

// Ledger and balances -----------------------------------------------------------------------------------------------

export interface BalanceKey {
  companyId: string;
  employeeId: string;
  leaveTypeId: string;
  year: number;
}

const balanceWhere = (k: BalanceKey) =>
  and(
    eq(leaveBalances.employeeId, k.employeeId),
    eq(leaveBalances.leaveTypeId, k.leaveTypeId),
    eq(leaveBalances.leaveYear, k.year),
  );

/** BUSINESS-RULES 4.2 step 1: creates the balance row if missing, then locks it with `SELECT … FOR UPDATE`. */
export async function lockBalance(tx: Tx, k: BalanceKey) {
  await tx
    .insert(leaveBalances)
    .values({
      employeeId: k.employeeId,
      leaveTypeId: k.leaveTypeId,
      leaveYear: k.year,
      companyId: k.companyId,
    })
    .onConflictDoNothing();
  const [row] = await tx.select().from(leaveBalances).where(balanceWhere(k)).for('update');
  if (!row) throw new Error('balance row missing after insert');
  return row;
}

export interface PostingContext extends BalanceKey {
  effectiveDate: string;
  leaveRequestId?: string | null;
  reversesEntryId?: string | null;
  policyId?: string | null;
  reason?: string | null;
  createdBy: string | null;
}

/**
 * Appends ledger entries and moves the locked balance row by `delta` in the caller's transaction (BUSINESS-RULES 4.1,
 * FR-LEAVE-009). The caller locked the row with `lockBalance`.
 */
export async function post(
  tx: Tx,
  ctx: PostingContext,
  postings: readonly LedgerPosting[],
  delta: BalanceColumns,
) {
  if (!postings.length) return [];
  const rows = await tx
    .insert(leaveLedgerEntries)
    .values(
      postings.map((p) => ({
        id: uuidv7(),
        companyId: ctx.companyId,
        employeeId: ctx.employeeId,
        leaveTypeId: ctx.leaveTypeId,
        leaveYear: ctx.year,
        type: p.type,
        amount: p.amount.toFixed(2),
        effectiveDate: ctx.effectiveDate,
        leaveRequestId: ctx.leaveRequestId ?? null,
        reversesEntryId: ctx.reversesEntryId ?? null,
        policyId: ctx.policyId ?? null,
        reason: ctx.reason ?? null,
        createdBy: ctx.createdBy,
      })),
    )
    .returning({ id: leaveLedgerEntries.id, type: leaveLedgerEntries.type });
  await tx
    .update(leaveBalances)
    .set({
      entitled: sql`${leaveBalances.entitled} + ${delta.entitled.toFixed(2)}::numeric`,
      used: sql`${leaveBalances.used} + ${delta.used.toFixed(2)}::numeric`,
      reserved: sql`${leaveBalances.reserved} + ${delta.reserved.toFixed(2)}::numeric`,
      adjusted: sql`${leaveBalances.adjusted} + ${delta.adjusted.toFixed(2)}::numeric`,
      updatedAt: sql`now()`,
      version: bump(leaveBalances),
    })
    .where(balanceWhere(ctx));
  return rows;
}

export async function findUsageEntry(tx: Tx, leaveRequestId: string) {
  const [row] = await tx
    .select({ id: leaveLedgerEntries.id })
    .from(leaveLedgerEntries)
    .where(and(eq(leaveLedgerEntries.leaveRequestId, leaveRequestId), eq(leaveLedgerEntries.type, 'usage')))
    .orderBy(desc(leaveLedgerEntries.createdAt))
    .limit(1);
  return row?.id ?? null;
}

const balanceColumns = {
  employeeId: employees.id,
  employeeCode: employees.employeeCode,
  employeeName,
  leaveTypeId: leaveTypes.id,
  leaveTypeCode: leaveTypes.code,
  leaveTypeName: leaveTypes.name,
  entitled: sql<string>`coalesce(${leaveBalances.entitled}, 0)::text`,
  used: sql<string>`coalesce(${leaveBalances.used}, 0)::text`,
  reserved: sql<string>`coalesce(${leaveBalances.reserved}, 0)::text`,
  adjusted: sql<string>`coalesce(${leaveBalances.adjusted}, 0)::text`,
  available: sql<string>`coalesce(${leaveBalances.available}, 0)::text`,
};

/**
 * Balances per employee and leave type for a year: every active type crossed with the employees in scope, zero where
 * nothing was posted yet. Paginated in SQL.
 */
export async function listBalances(
  db: Queryable,
  scope: RequestScope,
  q: BalancesQuery & { year: number },
  page: PageQuery,
) {
  const where = and(
    eq(employees.companyId, scope.companyId),
    inEmployeeScope(employees.id, scope),
    sql`${employees.status} NOT IN ('draft', 'preboarding', 'archived')`,
    q.employeeId ? eq(employees.id, q.employeeId) : undefined,
    q.departmentId ? eq(employees.departmentId, q.departmentId) : undefined,
    q.leaveTypeId ? eq(leaveTypes.id, q.leaveTypeId) : undefined,
  );
  const base = () =>
    db
      .select(balanceColumns)
      .from(employees)
      .innerJoin(
        leaveTypes,
        and(eq(leaveTypes.companyId, employees.companyId), eq(leaveTypes.isActive, true)),
      )
      .leftJoin(
        leaveBalances,
        and(
          eq(leaveBalances.employeeId, employees.id),
          eq(leaveBalances.leaveTypeId, leaveTypes.id),
          eq(leaveBalances.leaveYear, q.year),
        ),
      );
  const [rows, total] = await Promise.all([
    base()
      .where(where)
      .orderBy(asc(employees.employeeCode), asc(leaveTypes.sortOrder), asc(leaveTypes.id))
      .limit(page.pageSize)
      .offset(pageOffset(page)),
    db
      .select({ n: count() })
      .from(employees)
      .innerJoin(
        leaveTypes,
        and(eq(leaveTypes.companyId, employees.companyId), eq(leaveTypes.isActive, true)),
      )
      .where(where),
  ]);
  return { rows, total: total[0]?.n ?? 0 };
}

/** One employee's balances for a year, one row per active type. */
export function employeeBalances(db: Queryable, companyId: string, employeeId: string, year: number) {
  return db
    .select(balanceColumns)
    .from(employees)
    .innerJoin(leaveTypes, and(eq(leaveTypes.companyId, employees.companyId), eq(leaveTypes.isActive, true)))
    .leftJoin(
      leaveBalances,
      and(
        eq(leaveBalances.employeeId, employees.id),
        eq(leaveBalances.leaveTypeId, leaveTypes.id),
        eq(leaveBalances.leaveYear, year),
      ),
    )
    .where(and(eq(employees.companyId, companyId), eq(employees.id, employeeId)))
    .orderBy(asc(leaveTypes.sortOrder), asc(leaveTypes.id));
}

export async function balanceRow(
  db: Queryable,
  companyId: string,
  employeeId: string,
  leaveTypeId: string,
  year: number,
) {
  const [row] = await db
    .select(balanceColumns)
    .from(employees)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveTypeId))
    .leftJoin(
      leaveBalances,
      and(
        eq(leaveBalances.employeeId, employees.id),
        eq(leaveBalances.leaveTypeId, leaveTypes.id),
        eq(leaveBalances.leaveYear, year),
      ),
    )
    .where(and(eq(employees.companyId, companyId), eq(employees.id, employeeId)));
  return row ?? null;
}

export async function listLedger(
  db: Queryable,
  companyId: string,
  employeeId: string,
  q: LedgerQuery & { year: number },
) {
  const where = and(
    eq(leaveLedgerEntries.companyId, companyId),
    eq(leaveLedgerEntries.employeeId, employeeId),
    eq(leaveLedgerEntries.leaveYear, q.year),
    q.leaveTypeId ? eq(leaveLedgerEntries.leaveTypeId, q.leaveTypeId) : undefined,
  );
  const [rows, total] = await Promise.all([
    db
      .select({
        entry: leaveLedgerEntries,
        leaveTypeCode: leaveTypes.code,
        requestNumber: leaveRequests.requestNumber,
      })
      .from(leaveLedgerEntries)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveLedgerEntries.leaveTypeId))
      .leftJoin(leaveRequests, eq(leaveRequests.id, leaveLedgerEntries.leaveRequestId))
      .where(where)
      .orderBy(
        asc(leaveLedgerEntries.effectiveDate),
        asc(leaveLedgerEntries.createdAt),
        asc(leaveLedgerEntries.id),
      )
      .limit(q.pageSize)
      .offset(pageOffset(q)),
    db.select({ n: count() }).from(leaveLedgerEntries).where(where),
  ]);
  return { rows, total: total[0]?.n ?? 0 };
}

// Calendar ----------------------------------------------------------------------------------------------------------

export function calendarEntries(
  db: Queryable,
  scope: RequestScope,
  range: { from: string; to: string },
  statuses: readonly string[],
  departmentId?: string,
) {
  return db
    .select({
      id: leaveRequests.id,
      employeeId: leaveRequests.employeeId,
      employeeName,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      unit: leaveRequests.unit,
      halfDayPart: leaveRequests.halfDayPart,
      status: leaveRequests.status,
      typeId: leaveTypes.id,
      typeCode: leaveTypes.code,
      typeName: leaveTypes.name,
      typeColor: leaveTypes.colorToken,
    })
    .from(leaveRequests)
    .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(
      and(
        eq(leaveRequests.companyId, scope.companyId),
        inEmployeeScope(leaveRequests.employeeId, scope),
        inArray(leaveRequests.status, [...statuses]),
        lte(leaveRequests.startDate, range.to),
        gte(leaveRequests.endDate, range.from),
        departmentId ? eq(employees.departmentId, departmentId) : undefined,
      ),
    )
    .orderBy(asc(leaveRequests.startDate), asc(leaveRequests.id))
    .limit(1000);
}

/** Colleagues for the employee calendar: employees who share the caller's manager (BUSINESS-RULES open question). */
export async function peerIds(db: Queryable, companyId: string, employeeId: string) {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT p.id FROM employees me JOIN employees p ON p.manager_id = me.manager_id AND p.id <> me.id
    WHERE me.id = ${employeeId} AND me.company_id = ${companyId} AND p.company_id = ${companyId}
    LIMIT 500`);
  return rows.map((r) => r.id);
}
