import AxeBuilder from '@axe-core/playwright';
import { type BrowserContext, expect, type Page, test as base } from '@playwright/test';
import { type E2EUserKey, userEmail } from './users';

/** Signs a context in through the test-only route (TESTING-STRATEGY §4); strong sessions for privileged roles. */
export async function loginAs(context: BrowserContext, baseURL: string, key: E2EUserKey, strong = true) {
  const res = await context.request.post(`${baseURL}/api/v1/__test/login`, {
    data: { email: userEmail(key), strong },
    headers: { Origin: baseURL },
  });
  expect(res.status()).toBe(200);
}

/** The latest email to an address from the memory mailer. */
export async function lastEmail(page: Page, baseURL: string, to: string) {
  const res = await page.request.get(`${baseURL}/api/v1/__test/emails`, { params: { to } });
  const list = (await res.json()) as { subject: string; text: string }[];
  return list.at(-1);
}

/** Fails on serious or critical axe violations (TESTING-STRATEGY §4). */
export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

export const test = base;
export { expect };
