import type { BrowserContext, Page } from '@playwright/test';
import { expect, expectAccessible, lastEmail, loginAs, test } from '../support/fixtures';

/** Privileged roles meet the enrolment gate first (USER-FLOWS 1.3): register a passkey on a virtual authenticator. */
async function enrolPasskey(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  await page.goto('/me/security');
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByText('Passkey added')).toBeVisible();
}

// E2E-03: HR creates an employee with department, position and manager, invites them, and the employee accepts.
test('E2E-03 HR creates and invites an employee who accepts', async ({ page, context, baseURL, browser }) => {
  const base = baseURL as string;
  const stamp = Date.now().toString(36);
  const workEmail = `new.hire.${stamp}@example.test`;
  await loginAs(context, base, 'hr', true);
  await enrolPasskey(context, page);

  // Organization data for the pickers (fake data).
  const headers = { Origin: base };
  const dept = await page.request.post(`${base}/api/v1/departments`, {
    data: { code: `QA${stamp.slice(-4).toUpperCase()}`, name: `Quality ${stamp}` },
    headers,
  });
  expect(dept.status()).toBe(201);
  const position = await page.request.post(`${base}/api/v1/positions`, {
    data: { title: `Test analyst ${stamp}` },
    headers,
  });
  expect(position.status()).toBe(201);

  await page.goto('/employees/new');
  await expect(page.getByRole('heading', { level: 1, name: 'New employee' })).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel('First name').fill('Nadia');
  await page.getByLabel('Last name').fill(`Rahman ${stamp}`);
  await page.getByLabel('Department').fill(`Quality ${stamp}`);
  await page.getByRole('option', { name: `Quality ${stamp}` }).click();
  await page.getByLabel('Position').fill(`Test analyst ${stamp}`);
  await page.getByRole('option', { name: `Test analyst ${stamp}` }).click();
  await page.getByLabel('Manager').fill('Mina');
  await page.getByRole('option', { name: /EMP-0001 · Mina Manager/ }).click();
  await page.getByLabel('Joining date').fill('2026-01-05');
  await page.getByLabel('Work email').fill(workEmail);
  await expect(page.getByLabel('Invite them to sign in')).toBeChecked();
  await page.getByRole('button', { name: 'Create employee' }).click();

  await expect(page).toHaveURL(/\/employees\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Nadia Rahman ${stamp}`);
  await expect(page.getByText(`Invitation created. We'll email ${workEmail}.`)).toBeVisible();
  const overview = page.getByRole('tabpanel');
  await expect(overview.getByText(`Quality ${stamp}`)).toBeVisible();
  await expect(overview.getByText(`Test analyst ${stamp}`)).toBeVisible();
  await expect(overview.getByRole('link', { name: 'Mina Manager' })).toBeVisible();
  await expect(overview.getByText('Invited', { exact: true })).toBeVisible();
  await expectAccessible(page);

  // The invitee opens the emailed link in their own browser.
  await expect
    .poll(async () => (await lastEmail(page, base, workEmail))?.text ?? '')
    .toContain('accept-invite');
  const text = (await lastEmail(page, base, workEmail))?.text ?? '';
  const link = /https?:\/\/\S*accept-invite\S*/.exec(text)?.[0] ?? '';
  expect(link).not.toBe('');

  const invitee = await browser.newContext();
  const p2 = await invitee.newPage();
  await p2.goto(new URL(link).pathname + new URL(link).search);
  await expect(p2).toHaveURL(/\/accept-invite\/[^/?]+$/);
  await expectAccessible(p2);
  const before = (await lastEmail(p2, base, workEmail))?.subject;
  await p2.getByRole('button', { name: 'Continue' }).click();
  await expect(p2).toHaveURL(/\/sign-in\/verify/);
  await expect
    .poll(async () => {
      const subject = (await lastEmail(p2, base, workEmail))?.subject ?? '';
      return subject !== before ? subject : '';
    })
    .toMatch(/\d{6}/);
  const code = /(\d{6})/.exec((await lastEmail(p2, base, workEmail))?.subject ?? '')?.[1] ?? '';
  await p2.getByLabel('Sign-in code').fill(code);
  await p2.getByRole('button', { name: 'Verify' }).click();
  await expect(p2).toHaveURL(/\/dashboard/);
  await expect(p2.getByRole('heading', { level: 1 })).toContainText('Nadia');

  await p2.goto('/me');
  await expect(p2.getByRole('heading', { level: 1 })).toHaveText(`Nadia Rahman ${stamp}`);
  await expect(p2.getByText(`Quality ${stamp}`, { exact: true })).toBeVisible();
  await expect(p2.getByText('Mina Manager', { exact: true })).toBeVisible();
  await expectAccessible(p2);
  await invitee.close();

  // Back on the record, the account is now active.
  await page.reload();
  await expect(page.getByRole('tabpanel').getByText('Active', { exact: true }).last()).toBeVisible();
});

// E2E-09: employee B cannot open employee A's record by URL; the app shows the same 404 as the API.
test('E2E-09 an employee cannot open another employee record by URL', async ({ browser, baseURL }) => {
  const base = baseURL as string;
  const a = await browser.newContext();
  await loginAs(a, base, 'employee', false);
  const aProfile = await a.request.get(`${base}/api/v1/me/profile`);
  expect(aProfile.status()).toBe(200);
  const aId = ((await aProfile.json()) as { id: string }).id;
  await a.close();

  const b = await browser.newContext();
  await loginAs(b, base, 'employee2', false);
  const page = await b.newPage();
  expect((await page.request.get(`${base}/api/v1/employees/${aId}`)).status()).toBe(404);
  expect((await page.request.get(`${base}/api/v1/employees/${aId}/contact`)).status()).toBe(404);

  await page.goto(`/employees/${aId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("This page isn't here");
  await expect(page.getByText('Eman Employee')).toHaveCount(0);
  await expectAccessible(page);

  // Their own profile still works.
  await page.goto('/me');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bilal Second');
  await b.close();
});
