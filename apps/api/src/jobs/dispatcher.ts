import type { Tx } from '@hrm/db';
import { schema } from '@hrm/db';
import { addDays, toBusinessDate } from '@hrm/domain';
import type { Deps } from '../lib/deps';
import { dueOutboxIds, processOutbox } from '../lib/outbox';
import { type JobOutcome, type JobResult, runJob } from './run-job';

/** Context a daily step receives: the business date the dispatcher runs for (Asia/Dhaka). */
export interface DailyContext {
  deps: Deps;
  companyId: string;
  /** Today's business date. */
  today: string;
  /** Yesterday's business date (most steps finalise yesterday). */
  yesterday: string;
}

export interface DailyStep {
  job: string;
  /** Cheap date check in code before any query (JOBS-AND-OUTBOX §3.1). */
  runsOn(today: string): boolean;
  runKey(ctx: DailyContext): string;
  run(tx: Tx, ctx: DailyContext): Promise<JobResult>;
}

/** Steps in dispatcher order (JOBS-AND-OUTBOX §3). Modules add theirs in `steps.ts`. */
export async function dailyDispatcher(
  deps: Deps,
  steps: readonly DailyStep[],
  at: Date,
): Promise<Record<string, JobOutcome>> {
  const today = toBusinessDate(at);
  const companies = await deps.db.select({ id: schema.companies.id }).from(schema.companies);
  const outcomes: Record<string, JobOutcome> = {};
  for (const company of companies) {
    const ctx: DailyContext = { deps, companyId: company.id, today, yesterday: addDays(today, -1) };
    for (const step of steps) {
      if (!step.runsOn(today)) continue;
      outcomes[`${company.id}:${step.job}`] = await runJob(
        deps,
        company.id,
        step.job,
        step.runKey(ctx),
        (tx) => step.run(tx, ctx),
      );
    }
  }
  return outcomes;
}

/** The working-hours retry cron (JOBS-AND-OUTBOX §2.4): one query; stops when nothing is due. */
export async function outboxRetry(deps: Deps) {
  const ids = await dueOutboxIds(deps.db, deps.clock.now());
  return ids.length ? processOutbox(deps, ids) : { sent: 0, failed: 0 };
}
