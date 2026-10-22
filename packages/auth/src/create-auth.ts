import { passkey } from '@better-auth/passkey';
import { type Db, uuidv7 } from '@hrm/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP, twoFactor } from 'better-auth/plugins';

export interface AuthConfig {
  db: Db;
  /** Drizzle schema objects for the auth tables (from @hrm/db). */
  schema: Record<string, unknown>;
  secret: string;
  /** Public origin of the app, e.g. https://hrm.<account>.workers.dev. Passkeys are bound to its host. */
  baseURL: string;
  /** Sends the sign-in code inline (the user is waiting; EMAIL.md). */
  sendSignInCode: (input: { email: string; otp: string }) => Promise<void>;
}

/**
 * Better Auth, passwordless (ADR-0004, D-033):
 * - email one-time code (hashed at rest, 10 min, 5 attempts, no self sign-up: invite-only),
 * - passkeys (WebAuthn) bound to the app host,
 * - TOTP + backup codes for strong sessions, allowed without a password (`allowPasswordless`).
 * Email/password is disabled, so no password hashing ever runs (10 ms CPU budget, ADR-0009).
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
    session: {
      expiresIn: 60 * 60 * 24 * 7, // absolute 7 days (SECURITY-MODEL §7)
      updateAge: 60 * 60, // sliding refresh
      // Signed 60 s cookie cache: most requests verify one HMAC instead of querying the sessions table.
      // Suspension still applies immediately: the authz middleware loads user status + roles on every request (D-044).
      cookieCache: { enabled: true, maxAge: 60 },
    },
    rateLimit: { enabled: true, storage: 'database' },
    advanced: {
      cookiePrefix: 'hrm',
      database: { generateId: () => uuidv7() },
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
      twoFactor({ issuer: 'Big-Matrix HRM', allowPasswordless: true }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
