import type { EmployeeListQuery, EmployeeSortField } from '@hrm/contracts';
import { type Queryable, type RequestScope, schema, type Tx } from '@hrm/db';
import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { type AnyPgColumn, alias } from 'drizzle-orm/pg-core';
import { type PageQuery, pageOffset } from '../../lib/pagination';

const {
  employees,
  departments,
  positions,
  users,
  employeeContacts,
  employmentEvents,
  employmentContracts,
  profileChangeRequests,
  documents,
  sessions,
} = schema;

export type EmployeeRow = typeof employees.$inferSelect;
export type ContactRow = typeof employeeContacts.$inferSelect;
export type EventRow = typeof employmentEvents.$inferSelect;
export type ContractRow = typeof employmentContracts.$inferSelect;
export type ProfileChangeRow = typeof profileChangeRequests.$inferSelect;

/** Restricts an employee-id column to the scope with `IN (...)`, one parameter per id (no array parameters). */
function inScope(column: AnyPgColumn, scope: RequestScope) {
  if (scope.employees === 'all') return undefined;
  if (scope.employees.length === 0) return sql`false`;
  return inArray(column, [...scope.employees]);
}

const bump = <T extends { version: unknown }>(t: T) => sql`${t.version} + 1`;
const mgr = alias(employees, 'mgr');
const managerName = sql<
  string | null
>`coalesce(${mgr.preferredName}, ${mgr.firstName}) || ' ' || ${mgr.lastName}`;

// Employees ---------------------------------------------------------------------------------------------------------

const listColumns = {
  id: employees.id,
  employeeCode: employees.employeeCode,
  firstName: employees.firstName,
  lastName: employees.lastName,
  preferredName: employees.preferredName,
  workEmail: employees.workEmail,
  workPhone: employees.workPhone,
  status: employees.status,
  departmentId: employees.departmentId,
  departmentName: departments.name,
  positionId: employees.positionId,
  positionTitle: positions.title,
  managerId: employees.managerId,
  managerName,
  joiningDate: employees.joiningDate,
  version: employees.version,
  createdAt: employees.createdAt,
  updatedAt: employees.updatedAt,
};

const SORT_COLUMN: Record<EmployeeSortField, AnyPgColumn> = {
  employeeCode: employees.employeeCode,
  lastName: employees.lastName,
  joiningDate: employees.joiningDate,
};

/** Escapes LIKE wildcards in user search text. */
const likeText = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Employee list with the scope applied first, then the caller's filters (API-STANDARDS §6). Archived employees are
 * hidden unless the status filter asks for them (US-EMP-009). Sorted with `id` as the final tie-breaker.
 */
export async function listEmployees(db: Queryable, scope: RequestScope, query: EmployeeListQuery) {
  const where = and(
    eq(employees.companyId, scope.companyId),
    inScope(employees.id, scope),
    query.status ? inArray(employees.status, query.status) : ne(employees.status, 'archived'),
    query.departmentId ? eq(employees.departmentId, query.departmentId) : undefined,
    query.positionId ? eq(employees.positionId, query.positionId) : undefined,
    query.managerId ? eq(employees.managerId, query.managerId) : undefined,
    query.q
      ? sql`(${employees.firstName} || ' ' || ${employees.lastName} ILIKE ${likeText(query.q)}
          OR ${employees.preferredName} ILIKE ${likeText(query.q)}
          OR ${employees.employeeCode} ILIKE ${likeText(query.q)})`
      : undefined,
  );
  const sorts = (query.sort ?? [{ field: 'employeeCode' as const, direction: 'asc' as const }]).map((s) =>
    s.direction === 'desc' ? desc(SORT_COLUMN[s.field]) : asc(SORT_COLUMN[s.field]),
  );
  const [rows, [total]] = await Promise.all([
    db
      .select(listColumns)
      .from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(positions, eq(positions.id, employees.positionId))
      .leftJoin(mgr, eq(mgr.id, employees.managerId))
      .where(where)
      .orderBy(...sorts, asc(employees.id))
      .limit(query.pageSize)
      .offset(pageOffset(query)),
    db.select({ n: count() }).from(employees).where(where),
  ]);
  return { rows, total: total?.n ?? 0 };
}
export type EmployeeListRow = Awaited<ReturnType<typeof listEmployees>>['rows'][number];

export async function findEmployeeDetail(db: Queryable, companyId: string, id: string) {
  const [row] = await db
    .select({
      employee: employees,
      departmentName: departments.name,
      positionTitle: positions.title,
      managerName,
      userStatus: users.status,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(positions, eq(positions.id, employees.positionId))
    .leftJoin(mgr, eq(mgr.id, employees.managerId))
    .leftJoin(users, eq(users.id, employees.userId))
    .where(and(eq(employees.companyId, companyId), eq(employees.id, id)));
  return row ?? null;
}
export type EmployeeDetailRow = NonNullable<Awaited<ReturnType<typeof findEmployeeDetail>>>;

/** Locks the employee row for a change in this transaction. */
export async function lockEmployee(tx: Tx, companyId: string, id: string) {
  const [row] = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.id, id)))
    .for('update');
  return row ?? null;
}

export async function employeeExists(db: Queryable, companyId: string, id: string) {
  const [row] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.id, id)));
  return Boolean(row);
}

export async function insertEmployees(tx: Tx, values: (typeof employees.$inferInsert)[]) {
  if (!values.length) return;
  await tx.insert(employees).values(values);
}

/** Updates an employee; with `version` the update is optimistic and returns null on a stale version. */
export async function updateEmployee(
  tx: Tx,
  companyId: string,
  id: string,
  version: number | null,
  values: Partial<typeof employees.$inferInsert>,
) {
  const [row] = await tx
    .update(employees)
    .set({ ...values, version: bump(employees) })
    .where(
      and(
        eq(employees.companyId, companyId),
        eq(employees.id, id),
        version === null ? undefined : eq(employees.version, version),
      ),
    )
    .returning();
  return row ?? null;
}

/** Whether `managerId` reports (directly or not) to `employeeId`, so the link would close a cycle (BUSINESS-RULES §7.1). */
export async function wouldCreateCycle(db: Queryable, employeeId: string, managerId: string) {
  const rows = await db.execute<{ hit: number }>(sql`
    WITH RECURSIVE chain AS (
      SELECT id, manager_id, 1 AS depth FROM employees WHERE id = ${managerId}
      UNION ALL
      SELECT e.id, e.manager_id, c.depth + 1 FROM employees e JOIN chain c ON e.id = c.manager_id
      WHERE c.depth < 50
    )
    SELECT 1 AS hit FROM chain WHERE id = ${employeeId} LIMIT 1`);
  return rows.length > 0;
}

export async function departmentExists(db: Queryable, companyId: string, id: string) {
  const [row] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.companyId, companyId), eq(departments.id, id)));
  return Boolean(row);
}

export async function positionExists(db: Queryable, companyId: string, id: string) {
  const [row] = await db
    .select({ id: positions.id })
    .from(positions)
    .where(and(eq(positions.companyId, companyId), eq(positions.id, id)));
  return Boolean(row);
}

/** Reserves `n` consecutive employee code numbers in one statement; returns the first (BUSINESS-RULES §8). */
export async function reserveCodeNumbers(tx: Tx, companyId: string, n: number): Promise<number> {
  const rows = await tx.execute<{ first: string | number }>(sql`
    INSERT INTO code_sequences (company_id, scope, next_value) VALUES (${companyId}, 'employee', ${n + 1})
    ON CONFLICT (company_id, scope) DO UPDATE SET next_value = code_sequences.next_value + ${n}
    RETURNING next_value - ${n} AS first`);
  return Number(rows[0]?.first);
}

/** Moves the employee sequence above imported codes, so generated codes never collide with them (BUSINESS-RULES §8). */
export async function raiseCodeSequence(tx: Tx, companyId: string, atLeast: number) {
  await tx.execute(sql`
    INSERT INTO code_sequences (company_id, scope, next_value) VALUES (${companyId}, 'employee', ${atLeast})
    ON CONFLICT (company_id, scope) DO UPDATE SET next_value = GREATEST(code_sequences.next_value, ${atLeast})`);
}

/** Departments, positions, employee codes and work emails of the company: lookups for a CSV import. */
export async function importLookups(db: Queryable, companyId: string) {
  const [deps, pos, emps] = await Promise.all([
    db
      .select({ id: departments.id, code: departments.code })
      .from(departments)
      .where(eq(departments.companyId, companyId)),
    db
      .select({ id: positions.id, title: positions.title })
      .from(positions)
      .where(eq(positions.companyId, companyId)),
    db
      .select({ id: employees.id, code: employees.employeeCode, workEmail: employees.workEmail })
      .from(employees)
      .where(eq(employees.companyId, companyId)),
  ]);
  return {
    departments: new Map(deps.map((d) => [d.code.toUpperCase(), d.id])),
    positions: new Map(pos.map((p) => [p.title.toLowerCase(), p.id])),
    employeeCodes: new Map(emps.map((e) => [e.code, e.id])),
    workEmails: new Set(emps.flatMap((e) => (e.workEmail ? [e.workEmail.toLowerCase()] : []))),
  };
}

// Contact -----------------------------------------------------------------------------------------------------------

export async function findContact(db: Queryable, employeeId: string) {
  const [row] = await db.select().from(employeeContacts).where(eq(employeeContacts.employeeId, employeeId));
  return row ?? null;
}

/** Creates the contact row; null when another request created it first. */
export async function insertContact(tx: Tx, values: typeof employeeContacts.$inferInsert) {
  const [row] = await tx.insert(employeeContacts).values(values).onConflictDoNothing().returning();
  return row ?? null;
}

export async function updateContact(
  tx: Tx,
  employeeId: string,
  version: number | null,
  values: Partial<typeof employeeContacts.$inferInsert>,
) {
  const [row] = await tx
    .update(employeeContacts)
    .set({ ...values, version: bump(employeeContacts) })
    .where(
      and(
        eq(employeeContacts.employeeId, employeeId),
        version === null ? undefined : eq(employeeContacts.version, version),
      ),
    )
    .returning();
  return row ?? null;
}

// Employment events -------------------------------------------------------------------------------------------------

const creator = alias(users, 'creator');

export async function insertEvent(tx: Tx, values: typeof employmentEvents.$inferInsert) {
  const [row] = await tx.insert(employmentEvents).values(values).returning();
  if (!row) throw new Error('insert returned nothing');
  return row;
}

export async function listEvents(
  db: Queryable,
  employeeId: string,
  page: PageQuery,
  options: { hideSalary: boolean },
) {
  const where = and(
    eq(employmentEvents.employeeId, employeeId),
    options.hideSalary ? ne(employmentEvents.type, 'salary_changed') : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({ event: employmentEvents, creatorName: creator.name })
      .from(employmentEvents)
      .leftJoin(creator, eq(creator.id, employmentEvents.createdBy))
      .where(where)
      .orderBy(
        desc(employmentEvents.effectiveDate),
        desc(employmentEvents.createdAt),
        desc(employmentEvents.id),
      )
      .limit(page.pageSize)
      .offset(pageOffset(page)),
    db.select({ n: count() }).from(employmentEvents).where(where),
  ]);
  return { rows, total: total?.n ?? 0 };
}

/** Whether a status change is already waiting for its effective date. */
export async function hasScheduledStatusEvent(db: Queryable, employeeId: string) {
  const [row] = await db
    .select({ id: employmentEvents.id })
    .from(employmentEvents)
    .where(
      and(
        eq(employmentEvents.employeeId, employeeId),
        eq(employmentEvents.status, 'scheduled'),
        sql`${employmentEvents.changes} ? 'status'`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Scheduled events due on or before `today`, oldest first, locked (uses `employment_events_due_idx`). */
export function dueEvents(tx: Tx, companyId: string, today: string) {
  return tx
    .select()
    .from(employmentEvents)
    .where(
      and(
        eq(employmentEvents.status, 'scheduled'),
        sql`${employmentEvents.effectiveDate} <= ${today}`,
        eq(employmentEvents.companyId, companyId),
      ),
    )
    .orderBy(asc(employmentEvents.effectiveDate), asc(employmentEvents.createdAt), asc(employmentEvents.id))
    .limit(500)
    .for('update', { skipLocked: true });
}

/** The only change an event allows: `scheduled` to `applied` or `cancelled` (trigger `employment_events_guard`). */
export async function settleEvent(tx: Tx, id: string, status: 'applied' | 'cancelled', at: Date) {
  await tx
    .update(employmentEvents)
    .set({ status, appliedAt: status === 'applied' ? at : null })
    .where(and(eq(employmentEvents.id, id), eq(employmentEvents.status, 'scheduled')));
}

// Contracts ---------------------------------------------------------------------------------------------------------

export async function listContracts(db: Queryable, employeeId: string, page: PageQuery) {
  const where = eq(employmentContracts.employeeId, employeeId);
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(employmentContracts)
      .where(where)
      .orderBy(desc(employmentContracts.startDate), desc(employmentContracts.id))
      .limit(page.pageSize)
      .offset(pageOffset(page)),
    db.select({ n: count() }).from(employmentContracts).where(where),
  ]);
  return { rows, total: total?.n ?? 0 };
}

export async function findContract(db: Queryable, companyId: string, employeeId: string, id: string) {
  const [row] = await db
    .select()
    .from(employmentContracts)
    .where(
      and(
        eq(employmentContracts.companyId, companyId),
        eq(employmentContracts.employeeId, employeeId),
        eq(employmentContracts.id, id),
      ),
    );
  return row ?? null;
}

export async function insertContract(tx: Tx, values: typeof employmentContracts.$inferInsert) {
  const [row] = await tx.insert(employmentContracts).values(values).returning();
  if (!row) throw new Error('insert returned nothing');
  return row;
}

export async function updateContract(
  tx: Tx,
  id: string,
  version: number,
  values: Partial<typeof employmentContracts.$inferInsert>,
) {
  const [row] = await tx
    .update(employmentContracts)
    .set({ ...values, version: bump(employmentContracts) })
    .where(and(eq(employmentContracts.id, id), eq(employmentContracts.version, version)))
    .returning();
  return row ?? null;
}

/** A contract may link only an active document of the same employee. */
export async function documentOfEmployee(db: Queryable, companyId: string, employeeId: string, id: string) {
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.companyId, companyId),
        eq(documents.employeeId, employeeId),
        eq(documents.id, id),
        eq(documents.status, 'active'),
      ),
    );
  return Boolean(row);
}

// Profile change requests -------------------------------------------------------------------------------------------

const pcrColumns = {
  request: profileChangeRequests,
  employeeCode: employees.employeeCode,
  employeeName: sql<string>`coalesce(${employees.preferredName}, ${employees.firstName}) || ' ' || ${employees.lastName}`,
};
export type ProfileChangeListRow = {
  request: ProfileChangeRow;
  employeeCode: string;
  employeeName: string;
};

export async function insertProfileChange(tx: Tx, values: typeof profileChangeRequests.$inferInsert) {
  const [row] = await tx
    .insert(profileChangeRequests)
    .values(values)
    .returning({ id: profileChangeRequests.id });
  if (!row) throw new Error('insert returned nothing');
  return row.id;
}

export async function findProfileChange(db: Queryable, companyId: string, id: string) {
  const [row] = await db
    .select(pcrColumns)
    .from(profileChangeRequests)
    .innerJoin(employees, eq(employees.id, profileChangeRequests.employeeId))
    .where(and(eq(profileChangeRequests.companyId, companyId), eq(profileChangeRequests.id, id)));
  return row ?? null;
}

export async function lockProfileChange(tx: Tx, companyId: string, id: string) {
  const [row] = await tx
    .select()
    .from(profileChangeRequests)
    .where(and(eq(profileChangeRequests.companyId, companyId), eq(profileChangeRequests.id, id)))
    .for('update');
  return row ?? null;
}

export async function listProfileChanges(
  db: Queryable,
  scope: RequestScope,
  filters: { status?: readonly string[] | undefined; employeeId?: string | undefined },
  page: PageQuery,
) {
  const where = and(
    eq(profileChangeRequests.companyId, scope.companyId),
    inScope(profileChangeRequests.employeeId, scope),
    filters.status ? inArray(profileChangeRequests.status, [...filters.status]) : undefined,
    filters.employeeId ? eq(profileChangeRequests.employeeId, filters.employeeId) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select(pcrColumns)
      .from(profileChangeRequests)
      .innerJoin(employees, eq(employees.id, profileChangeRequests.employeeId))
      .where(where)
      .orderBy(desc(profileChangeRequests.createdAt), desc(profileChangeRequests.id))
      .limit(page.pageSize)
      .offset(pageOffset(page)),
    db.select({ n: count() }).from(profileChangeRequests).where(where),
  ]);
  return { rows, total: total?.n ?? 0 };
}

export async function updateProfileChange(
  tx: Tx,
  id: string,
  version: number,
  values: Partial<typeof profileChangeRequests.$inferInsert>,
) {
  const [row] = await tx
    .update(profileChangeRequests)
    .set({ ...values, version: bump(profileChangeRequests) })
    .where(and(eq(profileChangeRequests.id, id), eq(profileChangeRequests.version, version)))
    .returning({ id: profileChangeRequests.id });
  return row?.id ?? null;
}

// Access revocation (JOBS-AND-OUTBOX §3) ----------------------------------------------------------------------------

/**
 * Users of separated (or archived) employees whose last employed day is `lastDay` or earlier and who can still sign
 * in. Using "or earlier" rather than "exactly yesterday" also catches separations recorded after the fact.
 */
export async function usersToRevoke(tx: Tx, companyId: string, lastDay: string) {
  return tx
    .select({ userId: users.id, employeeId: employees.id })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(
      and(
        eq(employees.companyId, companyId),
        inArray(employees.status, ['separated', 'archived']),
        sql`${employees.separationDate} <= ${lastDay}`,
        ne(users.status, 'deactivated'),
      ),
    )
    .for('update', { of: users });
}

export async function deactivateUsers(tx: Tx, userIds: string[], at: Date) {
  if (!userIds.length) return;
  await tx
    .update(users)
    .set({ status: 'deactivated', statusChangedAt: at, version: bump(users) })
    .where(inArray(users.id, userIds));
  await tx.delete(sessions).where(inArray(sessions.userId, userIds));
}
