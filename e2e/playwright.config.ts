import { defineConfig, devices } from '@playwright/test';

// End-to-end journeys (TESTING-STRATEGY §4) against the built SPA served by `wrangler dev` with test routes and the
// memory mailer, on a dedicated database that global-setup recreates and seeds.
const PORT = Number(process.env.E2E_PORT ?? 8788);
export const BASE_URL = `http://localhost:${PORT}`;
const databaseUrl = process.env.E2E_DATABASE_URL ?? 'postgres://hrm:hrm@localhost:5432/hrm_e2e';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './global-setup.ts',
  use: { baseURL: BASE_URL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Machines with a preinstalled Chromium of another build (PW_CHROMIUM_PATH); CI installs its own.
        ...(process.env.PW_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
          : {}),
      },
    },
    // Nightly and before release (TESTING-STRATEGY §4): other engines and mobile viewports.
    ...(process.env.E2E_ALL_BROWSERS
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
          { name: 'pixel-7', use: { ...devices['Pixel 7'] } },
          { name: 'iphone-14', use: { ...devices['iPhone 14'] } },
        ]
      : []),
  ],
  webServer: {
    command: [
      'pnpm --filter @hrm/web build',
      `pnpm --filter @hrm/api exec wrangler dev --port ${PORT} --var APP_ENV:test --var MAILER:memory --var APP_ORIGIN:${BASE_URL} --var BETTER_AUTH_SECRET:e2e-only-secret-0123456789abcdef0123456789`,
    ].join(' && '),
    url: `${BASE_URL}/api/v1/health`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: { CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: databaseUrl },
  },
});
