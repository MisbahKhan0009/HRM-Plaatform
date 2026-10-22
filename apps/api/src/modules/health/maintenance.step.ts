import { auditCategoryValues } from '@hrm/contracts';
import type { Tx } from '@hrm/db';
import { businessDayBounds } from '@hrm/domain';
import { type SQL, sql } from 'drizzle-orm';
import type { DailyContext, DailyStep } from '../../jobs/dispatcher';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Raw SQL parameters must be strings for postgres-js: pass instants as ISO text cast to timestamptz. */
const at = (d: Date) => sql`${d.toISOString()}::timestamptz`;

async function deleted(tx: Tx, statement: SQL) {
  const [row] = await tx.execute<{ n: string }>(
    sql`WITH d AS (${statement} RETURNING 1) SELECT count(*) AS n FROM d`,
  );
  return Number(row?.n ?? 0);
}

/**
 * `maintenance.prune` (JOBS-AND-OUTBOX §3): retention deletes from DATABASE-CONVENTIONS §8, set-based so the step
 * stays within the CPU budget, and yesterday's audit row counts by category (AUDIT.md §6) in `job_runs.details`.
 * Tables without `company_id` (sessions, rate limits, idempotency records) are pruned globally; the first company's
 * run removes the rows and later runs find nothing.
 */
export const maintenancePrune: DailyStep = {
  job: 'maintenance.prune',
  runsOn: () => true,
  runKey: (ctx) => ctx.today,
  async run(tx: Tx, ctx: DailyContext) {
    const now = ctx.deps.clock.now();
    const nowMs = now.getTime();
    const counts = {
      idempotencyRecords: await deleted(
        tx,
        sql`DELETE FROM idempotency_records WHERE expires_at < ${at(now)}`,
      ),
      rateLimits: await deleted(tx, sql`DELETE FROM rate_limits WHERE last_request < ${nowMs - DAY_MS}`),
      sessions: await deleted(
        tx,
        sql`DELETE FROM sessions WHERE expires_at < ${at(new Date(nowMs - DAY_MS))}`,
      ),
      verifications: await deleted(tx, sql`DELETE FROM verifications WHERE expires_at < ${at(now)}`),
      outboxSent: 0,
      outboxDead: 0,
    };
    const prunable = sql`SELECT id FROM outbox_messages WHERE company_id = ${ctx.companyId} AND (
      (status = 'sent' AND coalesce(processed_at, created_at) < ${at(new Date(nowMs - 90 * DAY_MS))})
      OR (status = 'dead' AND created_at < ${at(new Date(nowMs - 365 * DAY_MS))}))`;
    await tx.execute(sql`DELETE FROM email_deliveries WHERE outbox_message_id IN (${prunable})`);
    const [outbox] = await tx.execute<{ sent: string; dead: string }>(sql`
      WITH d AS (DELETE FROM outbox_messages WHERE id IN (${prunable}) RETURNING status)
      SELECT count(*) FILTER (WHERE status = 'sent') AS sent, count(*) FILTER (WHERE status = 'dead') AS dead FROM d`);
    counts.outboxSent = Number(outbox?.sent ?? 0);
    counts.outboxDead = Number(outbox?.dead ?? 0);

    const { start, end } = businessDayBounds(ctx.yesterday);
    const rows = await tx.execute<{ category: string; n: string }>(sql`
      SELECT category, count(*) AS n FROM audit_logs
      WHERE company_id = ${ctx.companyId} AND occurred_at >= ${at(start)} AND occurred_at < ${at(end)}
      GROUP BY category`);
    const auditCounts = Object.fromEntries(
      auditCategoryValues.map((c) => [c, Number(rows.find((r) => r.category === c)?.n ?? 0)]),
    );

    return {
      items: Object.values(counts).reduce((a, b) => a + b, 0),
      details: { deleted: counts, auditDate: ctx.yesterday, auditCounts },
    };
  },
};
