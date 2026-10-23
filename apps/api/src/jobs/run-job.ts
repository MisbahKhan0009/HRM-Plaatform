import { schema, type Tx, uuidv7 } from '@hrm/db';
import { and, eq, sql } from 'drizzle-orm';
import { recordAudit } from '../lib/audit';
import { systemActor } from '../lib/auth-context';
import type { Deps } from '../lib/deps';

const { jobRuns } = schema;

export interface JobResult {
  items: number;
  details?: Record<string, unknown>;
  /** Outbox ids to send after commit. */
  outboxIds?: string[];
}

export type JobOutcome = 'succeeded' | 'skipped' | 'failed';

/**
 * Runs one job step at most once per `runKey` (JOBS-AND-OUTBOX §4). The step runs in one transaction; a failure is
 * recorded with its message and audited as `job.failed`, and the next run with the same key retries it.
 */
export async function runJob(
  deps: Deps,
  companyId: string,
  job: string,
  runKey: string,
  fn: (tx: Tx) => Promise<JobResult>,
): Promise<JobOutcome> {
  const [claimed] = await deps.db
    .insert(jobRuns)
    .values({ id: uuidv7(), companyId, job, runKey, status: 'running', startedAt: deps.clock.now() })
    .onConflictDoNothing()
    .returning({ id: jobRuns.id });
  let runId = claimed?.id;
  if (!runId) {
    const [existing] = await deps.db
      .select()
      .from(jobRuns)
      .where(and(eq(jobRuns.companyId, companyId), eq(jobRuns.job, job), eq(jobRuns.runKey, runKey)));
    if (existing?.status !== 'failed') return 'skipped';
    const [retry] = await deps.db
      .update(jobRuns)
      .set({ status: 'running', startedAt: deps.clock.now(), error: null })
      .where(and(eq(jobRuns.id, existing.id), eq(jobRuns.status, 'failed')))
      .returning({ id: jobRuns.id });
    if (!retry) return 'skipped';
    runId = retry.id;
  }
  try {
    const result = await deps.db.transaction(fn);
    await deps.db
      .update(jobRuns)
      .set({
        status: 'succeeded',
        finishedAt: deps.clock.now(),
        items: result.items,
        details: result.details ?? {},
      })
      .where(eq(jobRuns.id, runId));
    if (result.outboxIds?.length) {
      const { processOutbox } = await import('../lib/outbox');
      deps.defer(processOutbox(deps, result.outboxIds));
    }
    return 'succeeded';
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : 'unknown error';
    await deps.db
      .update(jobRuns)
      .set({ status: 'failed', finishedAt: deps.clock.now(), error: message })
      .where(eq(jobRuns.id, runId));
    await recordAudit(deps.db, systemActor(companyId), {
      action: 'job.failed',
      category: 'technical',
      entityType: 'job_run',
      entityId: runId,
      metadata: { job, runKey, error: message },
    });
    console.error(JSON.stringify({ level: 'error', msg: 'job failed', job, runKey }));
    return 'failed';
  }
}

/** Latest run of each job, for the health page. */
export function latestRuns(deps: Deps, companyId: string) {
  return deps.db.execute<{
    job: string;
    run_key: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    items: number;
  }>(sql`
    SELECT DISTINCT ON (job) job, run_key, status,
      to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS started_at,
      to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS finished_at, items
    FROM job_runs WHERE company_id = ${companyId} ORDER BY job, started_at DESC`);
}
