import { createTestSession } from '@hrm/auth/testing';
import { schema } from '@hrm/db';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { memoryMailer } from './lib/mailer';
import type { AppEnv } from './types';

/**
 * Test-only routes (TESTING-STRATEGY §4), reached only when the build sets __TEST_ROUTES__ and APP_ENV is "test".
 * CI checks that the marker __test_login is absent from the production bundle.
 */
export async function handleTestRoute(c: Context<AppEnv>): Promise<Response | null> {
  const path = c.req.path;
  const deps = c.var.deps;

  if (c.req.method === 'POST' && path === '/api/v1/__test/login') {
    const body = (await c.req.json()) as { userId?: string; email?: string; strong?: boolean };
    let userId = body.userId;
    if (!userId && body.email) {
      const [u] = await deps.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, body.email));
      userId = u?.id;
    }
    if (!userId) return c.json({ error: '__test_login: unknown user' }, 404);
    const s = await createTestSession(deps.auth(), userId, {
      strong: body.strong ?? false,
      now: deps.clock.now(),
    });
    const cookie = `${s.cookieName}=${encodeURIComponent(s.cookieValue)}`;
    const secure = c.env.APP_ORIGIN.startsWith('https://') ? '; Secure' : '';
    c.header('Set-Cookie', `${cookie}; Path=/; HttpOnly; SameSite=Lax${secure}`);
    return c.json({ sessionId: s.sessionId, cookie });
  }

  if (c.req.method === 'GET' && path === '/api/v1/__test/emails') {
    const to = c.req.query('to');
    // Emails captured by the memory mailer, newest last (E2E reads sign-in codes from here).
    return c.json(memoryMailer.sent.filter((m) => !to || m.to.toLowerCase() === to.toLowerCase()));
  }
  return null;
}
