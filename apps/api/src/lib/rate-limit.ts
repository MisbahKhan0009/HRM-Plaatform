import type { Queryable } from '@hrm/db';
import { sql } from 'drizzle-orm';
import { AppError } from './problem';

/**
 * Fixed-window rate limit stored in `rate_limits` (API-STANDARDS §10: Worker memory is per isolate). One upsert per
 * call; keys are prefixed `api:` so they never collide with Better Auth's own keys in the same table.
 */
export async function rateLimit(db: Queryable, key: string, max: number, windowSeconds: number, now: Date) {
  const nowMs = now.getTime();
  const windowStart = nowMs - windowSeconds * 1000;
  const rows = await db.execute<{ count: number; last_request: string }>(sql`
    INSERT INTO rate_limits (id, key, count, last_request) VALUES (gen_random_uuid(), ${`api:${key}`}, 1, ${nowMs})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.last_request < ${windowStart} THEN 1 ELSE rate_limits.count + 1 END,
      last_request = CASE WHEN rate_limits.last_request < ${windowStart} THEN ${nowMs} ELSE rate_limits.last_request END
    RETURNING count, last_request`);
  const row = rows[0];
  if (row && row.count > max) {
    const retryAfter = Math.max(
      1,
      Math.ceil((Number(row.last_request) + windowSeconds * 1000 - nowMs) / 1000),
    );
    throw new AppError('RATE_LIMITED', 'Too many requests', undefined, [], {
      'Retry-After': String(retryAfter),
    });
  }
}
