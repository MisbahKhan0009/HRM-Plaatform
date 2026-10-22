import { type Queryable, type RequestScope, schema, type Tx } from '@hrm/db';
import { and, desc, eq, gte, inArray, lte, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

const { reimbursementClaims: claims, employees, payrollItems, payrollRuns, documents } = schema;

/**
 * Restricts an employee-id column to the request scope. `whereEmployeeInScope` from `@hrm/db` binds the id list as one
 * array parameter, which postgres-js sends as a scalar when `fetch_types` is off; `IN (...)` binds each id instead.
 */
function inScope(column: AnyPgColumn, scope: RequestScope): SQL | undefined {
  if (scope.employees === 'all') return undefined;
  if (scope.employees.length === 0) return sql`false`;
  return inArray(column, [...scope.employees]);
}

export type ClaimRow = typeof claims.$inferSelect;

const claimColumns = {
  claim: claims,
  employeeCode: employees.employeeCode,
  employeeName: sql<string>`coalesce(${employees.preferredName}, ${employees.firstName}) || ' ' || ${employees.lastName}`,
  employeeUserId: employees.userId,
  runNumber: payrollRuns.runNumber,
};

export type ClaimView = {
  claim: ClaimRow;
  employeeCode: string;
  employeeName: string;
  employeeUserId: string | null;
  runNumber: string | null;
};

function selectClaims(db: Queryable) {
  return db
    .select(claimColumns)
    .from(claims)
    .innerJoin(employees, eq(employees.id, claims.employeeId))
    .leftJoin(payrollItems, eq(payrollItems.id, claims.payrollItemId))
    .leftJoin(payrollRuns, eq(payrollRuns.id, payrollItems.payrollRunId));
}

export async function findClaim(db: Queryable, scope: RequestScope, id: string): Promise<ClaimView | null> {
  const [row] = await selectClaims(db).where(
    and(eq(claims.companyId, scope.companyId), eq(claims.id, id), inScope(claims.employeeId, scope)),
  );
  return row ?? null;
}

/** Locks the claim row for a transition (MODULE-GUIDE §6: load with lock, check, write). */
export async function lockClaim(tx: Tx, scope: RequestScope, id: string): Promise<ClaimRow | null> {
  const [row] = await tx
    .select()
    .from(claims)
    .where(and(eq(claims.companyId, scope.companyId), eq(claims.id, id), inScope(claims.employeeId, scope)))
    .for('update');
  return row ?? null;
}

export async function listClaims(
  db: Queryable,
  scope: RequestScope,
  filters: { status?: string[]; employeeId?: string; from?: string; to?: string },
  limit: number,
  offset: number,
) {
  const where: (SQL | undefined)[] = [
    eq(claims.companyId, scope.companyId),
    inScope(claims.employeeId, scope),
    filters.status ? inArray(claims.status, filters.status) : undefined,
    filters.employeeId ? eq(claims.employeeId, filters.employeeId) : undefined,
    filters.from ? gte(claims.expenseDate, filters.from) : undefined,
    filters.to ? lte(claims.expenseDate, filters.to) : undefined,
  ];
  const [rows, [count]] = await Promise.all([
    selectClaims(db)
      .where(and(...where))
      .orderBy(desc(claims.expenseDate), desc(claims.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(claims)
      .where(and(...where)),
  ]);
  return { rows, total: count?.n ?? 0 };
}

export async function insertClaim(tx: Tx, values: typeof claims.$inferInsert) {
  await tx.insert(claims).values(values);
}

export async function updateClaim(
  tx: Tx,
  id: string,
  version: number,
  values: Partial<typeof claims.$inferInsert>,
): Promise<ClaimRow | null> {
  const [row] = await tx
    .update(claims)
    .set({ ...values, version: sql`${claims.version} + 1` })
    .where(and(eq(claims.id, id), eq(claims.version, version)))
    .returning();
  return row ?? null;
}

export async function deleteClaim(tx: Tx, id: string) {
  await tx.delete(claims).where(eq(claims.id, id));
}

/** A receipt the employee may attach: their own active `receipt` document (FR-REIM-001). */
export async function receiptBelongsTo(
  db: Queryable,
  companyId: string,
  documentId: string,
  employeeId: string,
) {
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.companyId, companyId),
        eq(documents.id, documentId),
        eq(documents.employeeId, employeeId),
        eq(documents.category, 'receipt'),
        eq(documents.status, 'active'),
      ),
    );
  return Boolean(row);
}

export async function employeeName(db: Queryable, employeeId: string) {
  const [row] = await db
    .select({
      name: sql<string>`coalesce(${employees.preferredName}, ${employees.firstName}) || ' ' || ${employees.lastName}`,
      userId: employees.userId,
    })
    .from(employees)
    .where(eq(employees.id, employeeId));
  return row ?? null;
}
