import type { DailyStep } from '../../jobs/dispatcher';
import { closeDay } from './attendance.repository';

/**
 * `attendance.close_day` (JOBS-AND-OUTBOX §3, BUSINESS-RULES 2.4): finalises yesterday's records in one set-based
 * statement. The run key is the work date, so a day closes once; re-running recomputes the same rows.
 */
export const closeDayStep: DailyStep = {
  job: 'attendance.close_day',
  runsOn: () => true,
  runKey: (ctx) => ctx.yesterday,
  async run(tx, ctx) {
    const items = await closeDay(tx, ctx.companyId, ctx.yesterday, ctx.deps.clock.now());
    return { items, details: { workDate: ctx.yesterday } };
  },
};
