import {
  type HealthDetails,
  type JobList,
  type JobRunResult,
  type OutboxRetryResult,
  P,
  type RunJobInput,
} from '@hrm/contracts';
import { schema } from '@hrm/db';
import { addDays, businessDayBounds, toBusinessDate } from '@hrm/domain';
import { and, eq, sql } from 'drizzle-orm';
import type { DailyContext } from '../../jobs/dispatcher';
import { latestRuns, runJob } from '../../jobs/run-job';
import { DAILY_STEPS } from '../../jobs/steps';
import { recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import type { Deps } from '../../lib/deps';
import { requirePermission, requireStrong } from '../../lib/guards';
import { notFound } from '../../lib/problem';

/** `GET /health/details` (FR-SET-004, JOBS-AND-OUTBOX §6): no business data, only operational counters. */
export async function healthDetails(deps: Deps, auth: AuthContext): Promise<HealthDetails> {
  requirePermission(auth, P.system.health.read);
  const now = deps.clock.now();

  const started = Date.now();
  let ok = true;
  try {
    await deps.db.execute(sql`SELECT 1`);
  } catch {
    ok = false;
  }
  const latencyMs = Date.now() - started;

  const jobs = await latestRuns(deps, auth.companyId);
  const outboxRows = await deps.db.execute<{ status: string; n: string; oldest: string | null }>(sql`
    SELECT status, count(*) AS n,
      to_char(min(created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS oldest
    FROM outbox_messages WHERE company_id = ${auth.companyId} GROUP BY status`);
  const counts = { pending: 0, processing: 0, sent: 0, failed: 0, dead: 0 };
  let oldest: number | null = null;
  for (const r of outboxRows) {
    if (r.status in counts) counts[r.status as keyof typeof counts] = Number(r.n);
    if ((r.status === 'pending' || r.status === 'failed') && r.oldest) {
      const t = Date.parse(r.oldest);
      oldest = oldest === null ? t : Math.min(oldest, t);
    }
  }

  // email_deliveries has no company column: count deliveries of this company's outbox messages, plus inline
  // sign-in codes sent to this company's users.
  const { start } = businessDayBounds(toBusinessDate(now));
  const [emails] = await deps.db.execute<{ sent: string; failed: string }>(sql`
    SELECT count(*) FILTER (WHERE d.status = 'sent') AS sent, count(*) FILTER (WHERE d.status = 'failed') AS failed
    FROM email_deliveries d LEFT JOIN outbox_messages o ON o.id = d.outbox_message_id
    WHERE d.attempted_at >= ${start.toISOString()}::timestamptz AND (o.company_id = ${auth.companyId}
      OR (d.outbox_message_id IS NULL AND EXISTS (
        SELECT 1 FROM users u WHERE u.email = d.to_address AND u.company_id = ${auth.companyId})))`);

  return {
    time: now.toISOString(),
    database: { ok, latencyMs },
    jobs: jobs.map((j) => ({
      job: j.job,
      runKey: j.run_key,
      status: j.status as HealthDetails['jobs'][number]['status'],
      startedAt: j.started_at,
      finishedAt: j.finished_at,
      items: Number(j.items),
    })),
    outbox: {
      counts,
      oldestPendingAgeSeconds:
        oldest === null ? null : Math.max(0, Math.floor((now.getTime() - oldest) / 1000)),
    },
    emailsToday: { sent: Number(emails?.sent ?? 0), failed: Number(emails?.failed ?? 0) },
  };
}

/**
 * `POST /admin/jobs/{job}/run` (JOBS-AND-OUTBOX §4): re-runs one daily step for a business date, ignoring the step's
 * calendar check. Steps are looked up at request time. A run key that already succeeded is skipped, not repeated.
 */
export async function runDailyStep(
  deps: Deps,
  auth: AuthContext,
  job: string,
  input: RunJobInput,
): Promise<JobRunResult> {
  requirePermission(auth, P.system.health.read);
  requirePermission(auth, P.settings.technical.manage);
  requireStrong(auth);
  const step = DAILY_STEPS.find((s) => s.job === job);
  if (!step) throw notFound();
  const today = input.date ?? toBusinessDate(deps.clock.now());
  const ctx: DailyContext = { deps, companyId: auth.companyId, today, yesterday: addDays(today, -1) };
  const runKey = input.runKey ?? step.runKey(ctx);
  await recordAudit(deps.db, auth.actor, {
    action: 'job.run_requested',
    category: 'technical',
    entityType: 'job',
    metadata: { job, runKey, date: today },
  });
  const outcome = await runJob(deps, auth.companyId, job, runKey, (tx) => step.run(tx, ctx));
  const [run] = await deps.db
    .select()
    .from(schema.jobRuns)
    .where(
      and(
        eq(schema.jobRuns.companyId, auth.companyId),
        eq(schema.jobRuns.job, job),
        eq(schema.jobRuns.runKey, runKey),
      ),
    );
  return {
    job,
    runKey,
    outcome,
    status: (run?.status ?? 'failed') as JobRunResult['status'],
    items: run?.items ?? 0,
    details: (run?.details ?? {}) as Record<string, unknown>,
    error: run?.error ?? null,
  };
}

/**
 * `GET /admin/jobs` (same permission as `/health/details`): every daily step, in dispatcher order, with its last run.
 * A routine read, so not audited (AUDIT §1).
 */
export async function listJobs(deps: Deps, auth: AuthContext): Promise<JobList> {
  requirePermission(auth, P.system.health.read);
  const runs = new Map((await latestRuns(deps, auth.companyId)).map((r) => [r.job, r]));
  return {
    data: DAILY_STEPS.map((step) => {
      const r = runs.get(step.job);
      return {
        job: step.job,
        lastRun: r
          ? {
              runKey: r.run_key,
              status: r.status as 'running' | 'succeeded' | 'failed',
              startedAt: r.started_at,
              finishedAt: r.finished_at,
              items: Number(r.items),
            }
          : null,
      };
    }),
  };
}

/** Messages sent right away by one retry; the rest wait for the outbox cron (JOBS-AND-OUTBOX §2.3). */
const RETRY_BATCH = 20;

/**
 * `POST /admin/outbox/retry`: makes every `failed` message of the company due now (dead messages stay dead) and
 * returns the ids to send after commit. The reset and its audit row share one transaction.
 */
export async function retryFailedOutbox(
  deps: Deps,
  auth: AuthContext,
): Promise<{ result: OutboxRetryResult; outboxIds: string[] }> {
  requirePermission(auth, P.system.health.read);
  requirePermission(auth, P.settings.technical.manage);
  requireStrong(auth);
  const now = deps.clock.now();
  const ids = await deps.db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.outboxMessages)
      .set({ nextAttemptAt: now })
      .where(
        and(eq(schema.outboxMessages.companyId, auth.companyId), eq(schema.outboxMessages.status, 'failed')),
      )
      .returning({ id: schema.outboxMessages.id });
    await recordAudit(tx, auth.actor, {
      action: 'outbox.retry_requested',
      category: 'technical',
      entityType: 'outbox_message',
      metadata: { reset: rows.length },
    });
    // uuidv7 ids sort oldest first.
    return rows.map((r) => r.id).sort();
  });
  const outboxIds = ids.slice(0, RETRY_BATCH);
  return { result: { reset: ids.length, processing: outboxIds.length }, outboxIds };
}
