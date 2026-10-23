import type { Page } from '@playwright/test';
import { expect, expectAccessible, lastEmail, test } from '../support/fixtures';
import { totp } from '../support/totp';

const AUDITOR = 'auditor@example.test';

/** Requests a sign-in code and enters it; returns once the code is accepted. */
async function signInWithEmailCode(page: Page, base: string) {
  const before = (await lastEmail(page, base, AUDITOR))?.subject ?? '';
  await page.goto('/sign-in');
  await page.getByLabel('Work email').fill(AUDITOR);
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  await expect(page).toHaveURL(/\/sign-in\/verify/);
  await expect.poll(async () => (await lastEmail(page, base, AUDITOR))?.subject ?? '').not.toBe(before);
  const code = /(\d{6})/.exec((await lastEmail(page, base, AUDITOR))?.subject ?? '')?.[1] ?? '';
  await page.getByLabel('Sign-in code').fill(code);
  await page.getByRole('button', { name: 'Verify' }).click();
}

// E2E-02: a privileged user signing in with an email code must hold and use a strong factor (D-006, D-033).
test('E2E-02 privileged user is held at enrolment, then stepped up with TOTP on the next sign-in', async ({
  page,
  baseURL,
}) => {
  const base = baseURL as string;

  // First sign-in: no factor yet, so the enrolment gate opens the security page.
  await signInWithEmailCode(page, base);
  await expect(page).toHaveURL(/\/me\/security/);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();
  const setupKey = page.getByText('Setup key');
  await expect(setupKey).toBeVisible();
  const secret = ((await setupKey.textContent()) ?? '').split(':')[1]?.trim() ?? '';
  expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  await page.getByLabel('Enter the 6-digit code from the app').fill(totp(secret));
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Recovery codes').first()).toBeVisible();
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hello, Arif');

  // Sign out; the next email-code sign-in stops at the two-factor step until a valid code is entered.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await signInWithEmailCode(page, base);
  await expect(page).toHaveURL(/\/sign-in\/two-factor/);
  await expectAccessible(page);
  await page.goto('/employees');
  await expect(page).not.toHaveURL(/\/employees/);
  await page.goto('/sign-in/two-factor');
  // The next time window's code: the first one may already have been used during enrolment.
  await page.getByLabel('Authenticator code').fill(totp(secret, 1));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto('/employees');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/employees/);
});
