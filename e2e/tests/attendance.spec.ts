import type { BrowserContext, Page } from '@playwright/test';
import { expect, expectAccessible, loginAs, test } from '../support/fixtures';
import type { E2EUserKey } from '../support/users';

// Attendance journeys (TESTING-STRATEGY §4). The clock is pinned on both sides: `X-Test-Now` fixes the server clock
// (test builds only) and Playwright's clock fixes the browser's, so business dates are reproducible. Dates are in the
// past and fall on the default Sun–Thu schedule; Asia/Dhaka is UTC+6.

/** Moves the server and browser clocks to `iso` and signs in again (a jump of hours would end an idle session). */
async function at(context: BrowserContext, page: Page, baseURL: string, key: E2EUserKey, iso: string) {
  await context.setExtraHTTPHeaders({ 'X-Test-Now': iso });
  await page.clock.setFixedTime(new Date(iso));
  await loginAs(context, baseURL, key, false);
}

test('E2E-04 employee checks in and out; the day shows present', async ({ page, context, baseURL }) => {
  const base = baseURL as string;
  // Sunday 4 Oct 2026, 9:30 am in Dhaka.
  await at(context, page, base, 'employee', '2026-10-04T03:30:00Z');
  await page.goto('/attendance');
  const main = page.getByRole('main');
  await expect(main.getByText('Not checked in').first()).toBeVisible();
  await expectAccessible(page);
  await main.getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(main.getByText('Checked in', { exact: true })).toBeVisible();
  await expect(main.getByText('9:30 am').first()).toBeVisible();

  // 6:40 pm: a 9h 10m day covers the seeded schedule's 8h minimum and its core window.
  await at(context, page, base, 'employee', '2026-10-04T12:40:00Z');
  await page.reload();
  await main.getByRole('button', { name: 'Check out', exact: true }).click();
  await expect(main.getByText('Checked out', { exact: true })).toBeVisible();
  const today = page.locator('section[aria-labelledby="today-title"]');
  await expect(today.getByText('Present', { exact: true })).toBeVisible();
  await expect(today.getByText('9h 10m')).toBeVisible();
  await expect(page.getByRole('button', { name: /Sun 4 October:\s*Present/ })).toBeVisible();
  await expectAccessible(page);

  const summary = await context.request.get(`${base}/api/v1/attendance/summary`, {
    params: { from: '2026-10-04', to: '2026-10-04' },
  });
  const body = (await summary.json()) as { data: { counts: { present: number } }[] };
  expect(body.data[0]?.counts.present).toBe(1);
});

test('E2E-05 correction requested, approved by the manager; the original event stays visible', async ({
  page,
  context,
  baseURL,
  browser,
}) => {
  const base = baseURL as string;
  // Monday 5 Oct 2026: a check-in at 9:00 am and no check-out.
  await at(context, page, base, 'employee2', '2026-10-05T03:00:00Z');
  const punch = await context.request.post(`${base}/api/v1/attendance/check-in`, {
    data: {},
    headers: { Origin: base },
  });
  expect(punch.status()).toBe(201);

  // Next morning the employee asks for the missing check-out.
  await at(context, page, base, 'employee2', '2026-10-06T04:00:00Z');
  await page.goto('/attendance?day=2026-10-05');
  const selected = page.locator('section[aria-labelledby="selected-day"]');
  await expect(selected.getByText('Missing punch')).toBeVisible();
  await selected.getByRole('button', { name: 'Request correction' }).click();
  const dialog = page.getByRole('dialog', { name: 'Request correction' });
  await expect(dialog.getByLabel('Check-in')).toHaveValue('09:00');
  await dialog.getByLabel('Check-out').fill('18:00');
  await dialog.getByLabel('Reason').fill('Left for a client visit and forgot to check out.');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Submit request' }).click();
  await expect(dialog).toBeHidden();
  const mine = page.locator('section[aria-labelledby="my-corrections"]');
  await expect(mine.getByText('Pending')).toBeVisible();

  // The manager approves from the approval inbox.
  const managerContext = await browser.newContext();
  const manager = await managerContext.newPage();
  await at(managerContext, manager, base, 'manager', '2026-10-06T05:00:00Z');
  await manager.goto('/approvals');
  await manager.getByRole('link', { name: 'Review' }).first().click();
  await manager.getByRole('link', { name: /Open request/ }).click();
  await expect(manager.getByRole('heading', { name: 'Attendance correction' })).toBeVisible();
  await expect(manager.getByText('Left for a client visit')).toBeVisible();
  await expectAccessible(manager);
  await manager.getByRole('button', { name: 'Approve' }).click();
  await expect(manager.getByText('Approved', { exact: true }).first()).toBeVisible();
  await managerContext.close();

  // The employee's day now shows the correction next to the original check-in.
  await page.reload();
  await expect(mine.getByText('Approved')).toBeVisible();
  await selected.getByRole('link', { name: 'View day details' }).click();
  const events = page.locator('section[aria-labelledby="day-events"]');
  await expect(events.getByText('Correction applied')).toBeVisible();
  await expect(events.getByText('Checked in', { exact: true })).toBeVisible();
  await expect(events.getByText('Original')).toBeVisible();
  await expect(page.getByText('Present', { exact: true }).first()).toBeVisible();
  await expectAccessible(page);
});
