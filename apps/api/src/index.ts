import { app } from './app';
import { dailyDispatcher, outboxRetry } from './jobs/dispatcher';
import { DAILY_STEPS } from './jobs/steps';
import { systemClock } from './lib/clock';
import { createDeps } from './lib/deps';

const RETRY_CRON = '*/15 2-14 * * SUN-THU';
const DAILY_CRON = '5 18 * * *';

export default {
  fetch: app.fetch,
  // Cron triggers (JOBS-AND-OUTBOX §1): outbox retry in Dhaka working hours, and the daily dispatcher at 00:05 Dhaka.
  async scheduled(controller, env, ctx) {
    const deps = createDeps(env, systemClock, {
      requestId: `cron-${controller.scheduledTime}`,
      ipAddress: null,
      userAgent: null,
    });
    const work = (async () => {
      if (controller.cron === RETRY_CRON) await outboxRetry(deps);
      else if (controller.cron === DAILY_CRON)
        await dailyDispatcher(deps, DAILY_STEPS, new Date(controller.scheduledTime));
    })();
    ctx.waitUntil(work.finally(() => deps.close()));
    await work;
  },
} satisfies ExportedHandler<Env>;
