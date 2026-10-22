import { inArray, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Which records a request may touch (DATABASE-CONVENTIONS §6). Built by the module policy from the permission
 * that granted access: `all`, the caller's team (recursive reports), or the caller's own employee id.
 */
export interface RequestScope {
  companyId: string;
  employees: 'all' | readonly string[];
}

/** Condition restricting an employee-id column to the scope; `undefined` (no condition) for `all`. */
export function whereEmployeeInScope(column: AnyPgColumn, scope: RequestScope): SQL | undefined {
  if (scope.employees === 'all') return undefined;
  if (scope.employees.length === 0) return sql`false`;
  // One bound parameter per id: array parameters are not typed when the client runs with fetch_types: false.
  return inArray(column, [...scope.employees]);
}

/** Drizzle writes a JS `null` as SQL NULL; a NOT NULL jsonb column that may hold JSON `null` needs the literal. */
export const jsonValue = (value: unknown) => (value === null ? sql`'null'::jsonb` : value);

/** `IN ($1, $2, …)` for a list of values; use instead of `= ANY($1::type[])` (array parameters are untyped here). */
export const inList = (values: readonly unknown[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );
