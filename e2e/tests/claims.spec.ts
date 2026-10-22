import { expect, expectAccessible, loginAs, test } from '../support/fixtures';

// A 1 × 1 PNG: real magic bytes, so the server's file sniffing accepts it as a receipt (FR-DOC-004).
const RECEIPT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Yesterday in Asia/Dhaka: a valid date of travel (not in the future, well within the maximum claim age). */
function yesterday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() - 86_400_000));
}

// E2E-07 (claim part): an employee submits a transport claim with a receipt; the manager approves it.
test('E2E-07 claim with receipt is submitted and approved by the manager', async ({
  page,
  context,
  baseURL,
  browser,
}) => {
  const base = baseURL as string;
  await loginAs(context, base, 'employee', false);

  await page.goto('/reimbursements');
  await expect(page.getByRole('heading', { level: 1, name: 'My claims' })).toBeVisible();
  await page.getByRole('link', { name: 'New claim' }).click();
  await expect(page).toHaveURL(/\/reimbursements\/new$/);

  await page.getByLabel('Date of travel').fill(yesterday());
  await page.getByLabel('Amount').fill('1850.5');
  await page.getByLabel('Purpose').fill('Client workshop in Gulshan, ride-share both ways.');
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'ride-receipt.png', mimeType: 'image/png', buffer: RECEIPT_PNG });
  await expect(page.getByText('ride-receipt.png')).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Submit claim' }).click();
  await expect(page).toHaveURL(/\/reimbursements\/[0-9a-f-]{36}$/);
  const claimUrl = page.url();
  await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/1,850\.50/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download receipt' })).toHaveAttribute(
    'href',
    /\/api\/v1\/documents\/[0-9a-f-]{36}\/download$/,
  );
  await expect(page.getByRole('button', { name: 'Withdraw' })).toBeVisible();
  await expectAccessible(page);

  const manager = await browser.newContext({ baseURL: base });
  await loginAs(manager, base, 'manager', false);
  const mgr = await manager.newPage();
  await mgr.goto('/approvals');
  await mgr.getByRole('link', { name: 'Review' }).first().click();
  await mgr.getByRole('link', { name: /Open request/ }).click();
  await expect(mgr).toHaveURL(claimUrl);
  await expect(mgr.getByText('Eman Employee · EMP-0002')).toBeVisible();

  // Rejecting needs a comment; cancel and approve instead.
  await mgr.getByRole('button', { name: 'Reject' }).click();
  await mgr.getByRole('button', { name: 'Reject claim' }).click();
  await expect(mgr.getByText('Add a comment so they know why.')).toBeVisible();
  await mgr.getByRole('button', { name: 'Cancel' }).click();

  await mgr.getByRole('button', { name: 'Approve', exact: true }).click();
  await mgr.getByRole('button', { name: 'Approve claim' }).click();
  await expect(mgr.getByText('Waiting for the next payroll run.')).toBeVisible();
  await expect(mgr.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  await expectAccessible(mgr);
  await manager.close();

  await page.reload();
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Withdraw' })).toHaveCount(0);
});
