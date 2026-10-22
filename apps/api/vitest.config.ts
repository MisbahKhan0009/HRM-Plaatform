import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// API tests run inside the real Workers runtime (Miniflare) against a real Postgres (TESTING-STRATEGY §2).
// test/global-setup.ts recreates the test database and applies migrations before the run.
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? 'postgres://hrm:hrm@localhost:5432/hrm_test';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          APP_ENV: 'test',
          APP_ORIGIN: 'https://hrm.test',
          MAILER: 'memory',
          BETTER_AUTH_SECRET: 'test-only-secret-not-used-anywhere-else-0123456789',
        },
        hyperdrives: { HYPERDRIVE: testDatabaseUrl },
      },
    }),
  ],
  test: {
    globalSetup: ['./test/global-setup.ts'],
    provide: { testDatabaseUrl },
    // One database for all files: each file creates its own company, so files stay independent.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
