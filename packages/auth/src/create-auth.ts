import { passkey } from '@better-auth/passkey';
import { type Db, uuidv7 } from '@hrm/db';
import { type BetterAuthPlugin, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { emailOTP, twoFactor } from 'better-auth/plugins';

export type AuthMethod = 'passkey' | 'email_otp';

export interface SignedInEvent {
  userId: string;
  sessionId: string;
  method: AuthMethod;
  strong: boolean;
}

export interface AuthConfig {
  db: Db;
  /** Drizzle schema objects for the auth tables (from @hrm/db). */
  schema: Record<string, unknown>;
  secret: string;
  /** Public origin of the app, e.g. https://hrm.<account>.workers.dev. Passkeys are bound to its host. */
  baseURL: string;
  /** Sends the sign-in code inline (the user is waiting; EMAIL.md §4). */
  sendSignInCode: (input: { email: string; otp: string }) => Promise<void>;
  /** Refuses new sessions for users who are not `active` (AUTH-IMPLEMENTATION §5). */
  canSignIn: (userId: string) => Promise<boolean>;
  /** Records the sign-in (last_login_at, audit `user.signed_in`). */
  onSignedIn: (event: SignedInEvent) => Promise<void>;
  /** Test-only plugins (`testUtils`); never set in staging or production. */
  extraPlugins?: BetterAuthPlugin[];
}

const STEP_UP_PATHS = new Set(['/two-factor/verify-totp', '/two-factor/verify-backup-code']);

/**
 * Better Auth, passwordless (ADR-0004, D-033):
 * - email one-time code (hashed at rest, 10 min, 5 attempts, no self sign-up: invite-only),
 * - passkeys (WebAuthn) bound to the app host,
 * - TOTP + backup codes for strong sessions, allowed without a password (`allowPasswordless`).
 * Email/password is disabled, so no password hashing ever runs (10 ms CPU budget, ADR-0009).
 *
 * Session strength (AUTH-IMPLEMENTATION §3) is written by the `after` hook: passkey sign-in and a valid TOTP or
 * backup code set `strong_auth_at`; email-code sign-in creates a weak session.
 */
export function createAuth(config: AuthConfig) {
  const host = new URL(config.baseURL).hostname;
  return betterAuth({
    appName: 'Big-Matrix HRM',
    baseURL: config.baseURL,
    basePath: '/api/v1/auth',
    secret: config.secret,
    trustedOrigins: [config.baseURL],
    database: drizzleAdapter(config.db, { provider: 'pg', usePlural: true, schema: config.schema }),
    emailAndPassword: { enabled: false },
    // Users are created only by the invitation service (invite-only), never through Better Auth sign-up.
    // Declaring our columns keeps them out of client input and lets Better Auth validate the schema.
    user: {
      additionalFields: {
        companyId: { type: 'string', required: true, input: false },
        status: { type: 'string', required: false, input: false },
        theme: { type: 'string', required: false, input: false },
        locale: { type: 'string', required: false, input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // absolute 7 days (SECURITY-MODEL §7)
      updateAge: 60 * 60, // sliding refresh
      freshAge: 60 * 15,
      // Signed 60 s cookie cache: most requests verify one HMAC instead of querying the sessions table.
      // Suspension and revocation still apply at once: the API reads the session row, user status and roles on
      // every request (D-044).
      cookieCache: { enabled: true, maxAge: 60 },
      additionalFields: {
        strongAuthAt: { type: 'date', required: false, input: false },
        authMethod: { type: 'string', required: false, input: false },
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 30,
      // API-STANDARDS §10
      customRules: {
        '/email-otp/send-verification-otp': { window: 600, max: 3 },
        '/sign-in/email-otp': { window: 600, max: 5 },
        '/two-factor/verify-totp': { window: 600, max: 5 },
        '/two-factor/verify-backup-code': { window: 600, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: 'hrm',
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      database: { generateId: () => uuidv7() },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => ((await config.canSignIn(session.userId)) ? undefined : false),
        },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.context.returned instanceof APIError) return;
        const created = ctx.context.newSession;
        const adapter = ctx.context.internalAdapter;
        const now = new Date();

        if (created && ctx.path === '/sign-in/email-otp') {
          await adapter.updateSession(created.session.token, { authMethod: 'email_otp' });
          await config.onSignedIn({
            userId: created.user.id,
            sessionId: created.session.id,
            method: 'email_otp',
            strong: false,
          });
        } else if (created && ctx.path === '/passkey/verify-authentication') {
          await adapter.updateSession(created.session.token, { authMethod: 'passkey', strongAuthAt: now });
          // Passkey step-up replaces a weak session of the same user with this strong one.
          const previous = await ctx.getSignedCookie(
            ctx.context.authCookies.sessionToken.name,
            ctx.context.secret,
          );
          if (previous && previous !== created.session.token) {
            const old = await adapter.findSession(previous);
            if (old?.session.userId === created.user.id) await adapter.deleteSession(previous);
          }
          await config.onSignedIn({
            userId: created.user.id,
            sessionId: created.session.id,
            method: 'passkey',
            strong: true,
          });
        } else if (STEP_UP_PATHS.has(ctx.path)) {
          // First TOTP confirmation replaces the session (Better Auth); later ones keep it.
          const token =
            created?.session.token ??
            (await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret));
          if (token) await adapter.updateSession(token, { strongAuthAt: now });
        }
      }),
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        disableSignUp: true,
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type === 'sign-in') await config.sendSignInCode({ email, otp });
        },
      }),
      passkey({ rpID: host, rpName: 'Big-Matrix HRM', origin: config.baseURL }),
      twoFactor({
        issuer: 'Big-Matrix HRM',
        allowPasswordless: true,
        totpOptions: { digits: 6, period: 30 },
        backupCodeOptions: { amount: 10, length: 10 },
      }),
      ...(config.extraPlugins ?? []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
