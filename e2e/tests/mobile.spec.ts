import { randomUUID } from 'node:crypto';
import { expect, expectAccessible, loginAs, test } from '../support/fixtures';

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

test.use({ viewport: { width: 360, height: 800 } });

// E2E-11 (check-in and leave request parts) at 360 × 800. The payslip download part runs after E2E-08 in
// payroll.spec.ts, which publishes the payslip.
test('E2E-11 mobile: check-in and leave request at 360 × 800', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const base = baseURL as string;

  // HR grants casual leave so the request has a balance to reserve.
  const hr = await browser.newContext();
  await loginAs(hr, base, 'hr', true);
  const types = (await (await hr.request.get(`${base}/api/v1/leave/types`)).json()) as {
    data: { id: string; code: string }[];
  };
  const casual = types.data.find((t) => t.code === 'CL');
  // Two Sundays ahead, so the dates are working days and clear of the other journeys.
  const start = new Date(Date.now() + 14 * DAY);
  while (start.getUTCDay() !== 0) start.setUTCDate(start.getUTCDate() + 1);
  const year = start.getUTCFullYear();
  const balances = (await (
    await hr.request.get(`${base}/api/v1/leave/balances`, {
      params: { year, leaveTypeId: casual?.id ?? '', pageSize: 100 },
    })
  ).json()) as { data: { employeeId: string; employeeCode: string }[] };
  const employeeId = balances.data.find((b) => b.employeeCode === 'EMP-0003')?.employeeId;
  const grant = await hr.request.post(`${base}/api/v1/leave/balances/adjustments`, {
    headers: { Origin: base, 'Idempotency-Key': randomUUID() },
    data: { employeeId, leaveTypeId: casual?.id, year, amount: '5', reason: 'E2E mobile grant' },
  });
  expect(grant.status()).toBe(201);
  await hr.close();

  // Check in from the dashboard card; nothing on the page scrolls sideways.
  await loginAs(context, base, 'employee2', false);
  await page.goto('/dashboard');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(main.getByRole('heading', { name: /^Checked in at / })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await expectAccessible(page);

  // Request one day of leave through the bottom navigation.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Leave' }).click();
  await expect(page).toHaveURL(/\/leave(\?|$)/);
  await page.getByRole('link', { name: 'Request leave' }).first().click();
  await page.getByLabel('Leave type').selectOption({ label: 'Casual leave · 5 days left' });
  await page.getByLabel('Start date').fill(iso(start));
  await page.getByLabel('End date').fill(iso(start));
  await expect(page.getByRole('complementary', { name: 'Before you submit' })).toContainText('1 day');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page).toHaveURL(/\/leave\/requests\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Pending', { exact: true }).first()).toBeVisible();
  await expectAccessible(page);
});
