import { expect, expectAccessible, loginAs, test } from '../support/fixtures';

// E2E-10: Ink by default; Paper survives a reload and a new session.
test('E2E-10 theme preference persists', async ({ page, context, baseURL, browser }) => {
  await loginAs(context, baseURL as string, 'employee2', false);
  await page.goto('/dashboard');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
  await expectAccessible(page);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');

  const fresh = await browser.newContext();
  await loginAs(fresh, baseURL as string, 'employee2', false);
  const page2 = await fresh.newPage();
  await page2.goto('/dashboard');
  await expect(page2.locator('html')).toHaveAttribute('data-theme', 'paper');
  await fresh.close();
});
