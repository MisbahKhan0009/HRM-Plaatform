import { expect, expectAccessible, lastEmail, test } from '../support/fixtures';

// E2E-01: sign in with an email code, register a passkey, sign out, sign in again with the passkey.
test('E2E-01 email code sign-in, passkey registration and passkey sign-in', async ({
  page,
  baseURL,
  context,
}) => {
  const base = baseURL as string;
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

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/sign-in/);
  await expectAccessible(page);
  await page.getByLabel('Work email').fill('employee@example.test');
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  await expect(page).toHaveURL(/\/sign-in\/verify/);
  await expectAccessible(page);

  await expect
    .poll(async () => (await lastEmail(page, base, 'employee@example.test'))?.subject ?? '')
    .toMatch(/\d{6}/);
  const code =
    /(\d{6})/.exec((await lastEmail(page, base, 'employee@example.test'))?.subject ?? '')?.[1] ?? '';
  await page.getByLabel('Sign-in code').fill(code);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hello, Eman');
  await expectAccessible(page);

  await page.goto('/me/security');
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByText('Passkey added')).toBeVisible();

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  expect((await page.request.get(`${base}/api/v1/auth/me`)).status()).toBe(401);

  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const me = await (await page.request.get(`${base}/api/v1/auth/me`)).json();
  expect(me.session).toMatchObject({ authMethod: 'passkey', strongAuth: true });
});
