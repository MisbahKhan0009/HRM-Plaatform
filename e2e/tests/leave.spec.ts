import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { expect, expectAccessible, loginAs, test } from '../support/fixtures';

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Today's business date in Asia/Dhaka (UTC+6, no DST). */
const dhakaToday = () => new Date(`${iso(new Date(Date.now() + 6 * 3_600_000))}T00:00:00Z`);

/** The next Sunday at least a week ahead, so Sunday to Tuesday is three working days (D-005, no holidays seeded). */
function nextSunday() {
  const d = new Date(dhakaToday().getTime() + 7 * DAY);
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** A StatBar cell's value inside the balance card for a leave type. */
const stat = (card: Locator, label: string) =>
  card
    .locator('dl > div')
    .filter({ has: card.page().getByText(label, { exact: true }) })
    .locator('dd');

async function expectBalance(page: Page, values: { Available: string; Reserved: string; Used: string }) {
  await page.goto('/leave');
  const card = page.getByRole('region', { name: 'Casual leave' });
  for (const [label, value] of Object.entries(values)) await expect(stat(card, label)).toHaveText(value);
}

// E2E-06 (TESTING-STRATEGY §4): request → reservation → approval → usage → cancellation → balance restored.
test('E2E-06 leave request, approval and cancellation keep the balance right', async ({
  browser,
  baseURL,
}) => {
  const base = baseURL as string;
  const start = nextSunday();
  const startDate = iso(start);
  const endDate = iso(new Date(start.getTime() + 2 * DAY));
  const year = Number(startDate.slice(0, 4));

  // HR grants ten days of casual leave through the adjustment API (strong session, Idempotency-Key).
  const hr = await browser.newContext();
  await loginAs(hr, base, 'hr', true);
  const types = (await (await hr.request.get(`${base}/api/v1/leave/types`)).json()) as {
    data: { id: string; code: string }[];
  };
  const casual = types.data.find((t) => t.code === 'CL');
  expect(casual).toBeTruthy();
  const balances = (await (
    await hr.request.get(`${base}/api/v1/leave/balances`, {
      params: { year, leaveTypeId: casual?.id ?? '', pageSize: 100 },
    })
  ).json()) as { data: { employeeId: string; employeeCode: string }[] };
  const employeeId = balances.data.find((b) => b.employeeCode === 'EMP-0002')?.employeeId;
  const grant = await hr.request.post(`${base}/api/v1/leave/balances/adjustments`, {
    headers: { Origin: base, 'Idempotency-Key': randomUUID() },
    data: { employeeId, leaveTypeId: casual?.id, year, amount: '10', reason: 'E2E opening grant' },
  });
  expect(grant.status()).toBe(201);
  await hr.close();

  const employeeContext = await browser.newContext();
  await loginAs(employeeContext, base, 'employee', false);
  const employee = await employeeContext.newPage();
  const managerContext = await browser.newContext();
  await loginAs(managerContext, base, 'manager', false);
  const manager = await managerContext.newPage();

  // Request: the preview shows working days, the submit reserves them.
  await expectBalance(employee, { Available: '10', Reserved: '0', Used: '0' });
  await expectAccessible(employee);
  await employee.getByRole('link', { name: 'Request leave' }).click();
  await employee.getByLabel('Leave type').selectOption({ label: 'Casual leave · 10 days left' });
  await employee.getByLabel('Start date').fill(startDate);
  await employee.getByLabel('End date').fill(endDate);
  const preview = employee.getByRole('complementary', { name: 'Before you submit' });
  await expect(preview).toContainText('3 days');
  await expect(preview).toContainText('7 days');
  await expectAccessible(employee);
  await employee.getByRole('button', { name: 'Submit request' }).click();
  await expect(employee).toHaveURL(/\/leave\/requests\/[0-9a-f-]{36}$/);
  const requestUrl = new URL(employee.url()).pathname;
  await expect(employee.getByText('Pending', { exact: true }).first()).toBeVisible();
  await expectBalance(employee, { Available: '7', Reserved: '3', Used: '0' });

  // The manager approves: the reservation becomes usage.
  await manager.goto(requestUrl);
  await expectAccessible(manager);
  await manager.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(manager.getByText('Leave request approved')).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  await expectBalance(employee, { Available: '7', Reserved: '0', Used: '3' });

  // The employee asks to cancel the approved leave.
  await employee.goto(requestUrl);
  await employee.getByRole('button', { name: 'Request cancellation' }).click();
  const dialog = employee.getByRole('alertdialog', { name: 'Cancel approved leave?' });
  await dialog.getByLabel(/Reason/).fill('Plans changed');
  await dialog.getByRole('button', { name: 'Request cancellation' }).click();
  await expect(employee.getByText('Cancellation pending', { exact: true }).first()).toBeVisible();

  // The manager approves the cancellation: usage is reversed and the balance is whole again.
  await manager.goto(requestUrl);
  await manager.getByRole('button', { name: 'Approve cancellation' }).click();
  await expect(manager.getByText('Cancellation approved').first()).toBeVisible();
  await expectBalance(employee, { Available: '10', Reserved: '0', Used: '0' });
  await expect(employee.getByRole('row', { name: /Casual leave/ }).getByText('Cancelled')).toBeVisible();
  await expectAccessible(employee);

  await employeeContext.close();
  await managerContext.close();
});

// E2E-09 (leave part): another employee's request answers with the not-found page.
test('E2E-09 an employee cannot open a colleague’s leave request', async ({ browser, baseURL }) => {
  const base = baseURL as string;
  const ctx = await browser.newContext();
  await loginAs(ctx, base, 'employee', false);
  const list = (await (await ctx.request.get(`${base}/api/v1/leave/requests`)).json()) as {
    data: { id: string }[];
  };
  const own = list.data[0]?.id;
  await ctx.close();
  test.skip(!own, 'Needs the request from E2E-06');

  const other = await browser.newContext();
  await loginAs(other, base, 'employee2', false);
  const page = await other.newPage();
  await page.goto(`/leave/requests/${own}`);
  await expect(page.getByRole('heading', { name: "This page isn't here" })).toBeVisible();
  await other.close();
});
