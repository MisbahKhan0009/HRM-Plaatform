import { readFile } from 'node:fs/promises';
import { expect, expectAccessible, loginAs, test } from '../support/fixtures';
import { E2E_USERS } from '../support/users';

// E2E-08 (TESTING-STRATEGY §4): one payroll officer runs the whole month, self-approving with a justification, then an
// employee downloads the payslip PDF built in the browser. E2E-09 (payslip part): another employee gets the 404 page.
test('E2E-08 payroll run end to end, and E2E-09 payslip isolation', async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const base = baseURL as string;

  const officer = await browser.newContext();
  await loginAs(officer, base, 'payroll');
  const page = await officer.newPage();

  // Create (period created on the fly) and calculate.
  await page.goto('/payroll');
  await page.getByRole('button', { name: 'Create payroll run' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create payroll run' }).click();
  await expect(page).toHaveURL(/\/payroll\/runs\//);
  const runNumber = (await page.locator('h1 + span.font-mono').textContent())?.trim() ?? '';
  expect(runNumber).toMatch(/^PR-\d{4}-\d{2}-\d{2}$/);
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByRole('button', { name: 'Submit for approval' })).toBeEnabled();
  await expect(page.getByRole('row')).toHaveCount(E2E_USERS.length + 1); // header + every seeded employee
  await expectAccessible(page);

  // Validate and submit (level 3 with totals).
  await page.getByRole('tab', { name: /Validation/ }).click();
  await expect(page.getByText('No blocking errors.')).toBeVisible();
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Net pay');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Submit for approval' }).click();

  // Self-approval needs a justification of at least 20 characters and the review check (D-007).
  await page.getByRole('button', { name: 'Approve run' }).click();
  const approve = page.getByRole('dialog');
  await expect(approve).toContainText('You prepared this run');
  await approve.getByLabel('Reason for approving your own run').fill('Too short');
  await approve.getByRole('button', { name: 'Approve run' }).click();
  await expect(approve).toContainText('at least 20 characters');
  await approve
    .getByLabel('Reason for approving your own run')
    .fill('Director on leave this week; totals checked against last month.');
  await approve.getByLabel('I have reviewed the totals and validation results').check();
  await approve.getByRole('button', { name: 'Approve run' }).click();
  await expect(page.getByText('Self-approved').first()).toBeVisible();

  // Lock: typed confirmation of the run number (level 4).
  await page.getByRole('button', { name: 'Lock run' }).click();
  const lock = page.getByRole('alertdialog');
  await expect(lock.getByRole('button', { name: 'Lock run' })).toBeDisabled();
  await lock.getByLabel(/to confirm/).fill(runNumber);
  await lock.getByRole('button', { name: 'Lock run' }).click();
  await expect(page.getByText('This run is locked.')).toBeVisible();

  // Record one cheque payment per employee (level 3 each).
  await page.getByRole('button', { name: 'Record payments' }).click();
  const record = page.getByRole('button', { name: 'Record payment', exact: true });
  await expect(record).toHaveCount(E2E_USERS.length);
  for (let left = E2E_USERS.length; left > 0; left--) {
    await record.first().click();
    await page.getByRole('dialog').getByLabel('Cheque number').fill(`9100${left}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Record payment' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByRole('alertdialog')).toBeHidden();
    await expect(record).toHaveCount(left - 1);
  }
  await expectAccessible(page);

  // Paid, reconciled, payslips published.
  await page.getByRole('button', { name: 'Mark as paid' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Mark as paid' }).click();
  await page.getByRole('button', { name: 'Mark as reconciled' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Mark as reconciled' }).click();
  await page.getByRole('button', { name: 'Publish payslips' }).click();
  await page
    .getByRole('alertdialog')
    .getByLabel(/to confirm/)
    .fill(runNumber);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish payslips' }).click();
  await expect(page.getByText(/Payslips published/)).toBeVisible();
  await expect(page.getByText('Reconciled', { exact: true }).first()).toBeVisible();
  await officer.close();

  // The employee downloads their payslip; the PDF is generated in the browser.
  const employee = await browser.newContext({ acceptDownloads: true });
  await loginAs(employee, base, 'employee', false);
  const ep = await employee.newPage();
  await ep.goto('/payslips');
  await ep.getByRole('link', { name: /\d{4}/ }).first().click();
  await expect(ep.getByRole('heading', { name: /^Payslip / })).toBeVisible();
  await expect(ep.getByText(runNumber, { exact: true })).toBeVisible();
  const payslipUrl = ep.url();
  const [download] = await Promise.all([
    ep.waitForEvent('download'),
    ep.getByRole('button', { name: 'Download PDF' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^payslip-\d{4}-\d{2}-EMP-0002\.pdf$/);
  const pdf = await readFile((await download.path()) as string);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  await expectAccessible(ep);
  await employee.close();

  // E2E-09: another employee editing the URL gets the not-found page.
  const other = await browser.newContext();
  await loginAs(other, base, 'employee2', false);
  const op = await other.newPage();
  await op.goto(payslipUrl);
  await expect(op.getByText("This page isn't here")).toBeVisible();
  await other.close();
});

// E2E-11 (payslip part): runs after E2E-08 in this file, which published the payslip.
test('E2E-11 mobile: payslip download at 360 × 800', async ({ browser, baseURL }) => {
  const base = baseURL as string;
  const employee = await browser.newContext({ acceptDownloads: true, viewport: { width: 360, height: 800 } });
  await loginAs(employee, base, 'employee', false);
  const page = await employee.newPage();
  await page.goto('/payslips');
  await page.getByRole('link', { name: /\d{4}/ }).first().click();
  await expect(page.getByRole('heading', { name: /^Payslip / })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PDF' }).click(),
  ]);
  const pdf = await readFile((await download.path()) as string);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  await expectAccessible(page);
  await employee.close();
});
