import type { ErrorCode } from '@hrm/contracts';
import { AppError } from './problem';

interface PgError {
  code?: string;
  constraint_name?: string;
  message?: string;
}

function pgError(err: unknown): PgError | null {
  let e: unknown = err;
  for (let i = 0; i < 3 && e; i++) {
    if (typeof e === 'object' && e !== null && 'code' in e && typeof (e as PgError).code === 'string') {
      const code = (e as PgError).code as string;
      if (/^[0-9A-Z]{5}$/.test(code)) return e as PgError;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/** Maps constraint names to catalogue codes; `path` names the field in `errors` (API-STANDARDS §7). */
export type ConstraintMap = Record<string, { code: ErrorCode; path?: string }>;

/**
 * Translates database constraint violations into documented errors (CODING-STANDARDS §4.3). Unique violations
 * (23505) use the map, falling back to DUPLICATE; trigger guards (restrict_violation, 23001) become
 * PAYROLL_RUN_LOCKED or BUSINESS_RULE_VIOLATION. Constraint names never reach the client. Anything else is rethrown.
 */
export function mapDbError(err: unknown, map: ConstraintMap = {}): never {
  const pg = pgError(err);
  if (pg?.code === '23505') {
    const hit = (pg.constraint_name && map[pg.constraint_name]) || { code: 'DUPLICATE' as const };
    throw new AppError(
      hit.code,
      'Already exists',
      undefined,
      hit.path ? [{ path: hit.path, code: 'duplicate', message: 'Already used.' }] : [],
    );
  }
  if (pg?.code === '23P01') {
    const hit = (pg.constraint_name && map[pg.constraint_name]) || {
      code: 'BUSINESS_RULE_VIOLATION' as const,
    };
    throw new AppError(hit.code, 'Overlapping dates', 'The dates overlap an existing record.');
  }
  if (pg?.code === '23001') {
    if (pg.message?.includes('payroll run is locked'))
      throw new AppError('PAYROLL_RUN_LOCKED', 'Payroll run is locked');
    throw new AppError('BUSINESS_RULE_VIOLATION', 'Not allowed', 'This record can no longer be changed.');
  }
  throw err;
}

/** Runs `fn` and maps constraint errors. */
export async function withDbErrors<T>(fn: () => Promise<T>, map: ConstraintMap = {}): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    return mapDbError(err, map);
  }
}
