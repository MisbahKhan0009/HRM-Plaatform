import { app } from './app';

export default {
  fetch: app.fetch,
  // Cron dispatcher (ARCHITECTURE.md §4). Jobs are registered in Stage 8.
  async scheduled(_controller, _env, _ctx) {},
} satisfies ExportedHandler<Env>;
