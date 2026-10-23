import { makeSignature } from 'better-auth/crypto';
import type { Auth } from './create-auth';

/**
 * Test-only session creation (TESTING-STRATEGY §4): creates a session for a user and returns the signed cookie, as a
 * real sign-in would. Imported only by the API's test routes, which staging and production builds drop.
 */
export async function createTestSession(auth: Auth, userId: string, options: { strong: boolean; now: Date }) {
  const ctx = await auth.$context;
  const session = await ctx.internalAdapter.createSession(userId, false, {
    authMethod: options.strong ? 'passkey' : 'email_otp',
    strongAuthAt: options.strong ? options.now : null,
  });
  if (!session) throw new Error('Session was not created (is the user active?)');
  const signed = `${session.token}.${await makeSignature(session.token, ctx.secret)}`;
  return { sessionId: session.id, cookieName: ctx.authCookies.sessionToken.name, cookieValue: signed };
}
