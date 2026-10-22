# Authentication implementation

Status: **Accepted**, 2026-10-22. Normative. Implements ADR-0004 and D-033 (passwordless) with the role rules from `docs/03-architecture/SECURITY-MODEL.md` sections 2 and 7. Endpoints are listed in `API-CATALOGUE.md` section 1.

Three items depend on Better Auth behaviour that must be confirmed in the Stage 7 spike against the pinned version; each has a documented fallback. They are listed in section 10.

## 1. Factors

| Factor | Plugin | Session strength | Notes |
|---|---|---|---|
| Passkey (WebAuthn) | `passkey` | strong | Preferred. RP ID = Worker hostname |
| Email one-time code | `emailOTP` | weak | 6 digits, 10 min expiry, 5 attempts, stored hashed |
| Authenticator app (TOTP) | `twoFactor` | upgrades a weak session to strong | 6 digits, 30 s period, 10 single-use backup codes |

No passwords exist anywhere: the `emailAndPassword` option stays disabled, so the 10 ms CPU limit is never spent on password hashing (ADR-0009).

## 2. Server configuration

`packages/auth/src/auth.ts` builds the instance per request, because Worker bindings are only available on the request context:

```ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP, twoFactor } from 'better-auth/plugins';
import { passkey } from 'better-auth/plugins/passkey'; // or '@better-auth/passkey', per pinned version
import { uuidv7 } from 'uuidv7';

export function createAuth(env: Env, db: Db, mailer: Mailer) {
  const origin = env.APP_ORIGIN;                      // https://hrm.<account>.workers.dev
  return betterAuth({
    appName: 'Big-Matrix HRM',
    baseURL: origin,
    basePath: '/api/v1/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [origin],
    database: drizzleAdapter(db, { provider: 'pg', schema, usePlural: true }),
    advanced: {
      database: { generateId: () => uuidv7() },
      useSecureCookies: true,
      cookiePrefix: 'hrm',
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    emailAndPassword: { enabled: false },
    user: {
      additionalFields: {
        companyId: { type: 'string', input: false },
        status:    { type: 'string', input: false, defaultValue: 'invited' },
        theme:     { type: 'string', input: false, defaultValue: 'ink' },
        locale:    { type: 'string', input: false, defaultValue: 'en' },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,      // absolute 7 days
      updateAge: 60 * 60,               // refresh expiry at most hourly
      freshAge: 60 * 15,                // "Fresh" = 15 min (SECURITY-MODEL section 7)
      cookieCache: { enabled: false },  // always read the DB, so suspension takes effect at once
      additionalFields: {
        strongAuthAt: { type: 'date', required: false, input: false },
        authMethod:   { type: 'string', required: false, input: false },
      },
    },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 30, customRules: rateLimitRules },
    plugins: [
      emailOTP({
        disableSignUp: true,            // invite-only (FR-AUTH-005)
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== 'sign-in') return;
          await mailer.sendSignInCode({ to: email, code: otp });   // inline, see EMAIL.md
        },
      }),
      passkey({ rpID: new URL(origin).hostname, rpName: 'Big-Matrix HRM', origin }),
      twoFactor({
        issuer: 'Big-Matrix HRM',
        allowPasswordless: true,        // users have no password (confirm in spike, section 10)
        totpOptions: { digits: 6, period: 30 },
        backupCodeOptions: { amount: 10, length: 10 },
      }),
    ],
    databaseHooks: { session: { create: { before: assertUserMayAuthenticate } } },
  });
}
```

`rateLimitRules` implements the table in `API-STANDARDS.md` section 10. The Hono app mounts Better Auth with `app.on(['GET', 'POST'], '/api/v1/auth/*', (c) => createAuth(...).handler(c.req.raw))`, after our own `/auth/me`, `/auth/step-up/*`, `/auth/invitations/*` routes so ours match first.

## 3. Session strength

A session is **strong** when `strongAuthAt` is set. It is set:

- on passkey sign-in, by an `after` hook on `/passkey/verify-authentication` (`authMethod = 'passkey'`);
- on `POST /auth/step-up/totp` after a valid TOTP or backup code;
- on `POST /auth/step-up/passkey` after a valid passkey assertion on an existing session.

Email OTP sign-in creates a session with `authMethod = 'email_otp'` and no `strongAuthAt`.

### 3.1 Middleware rules

`requireSession` (all API routes except public ones) loads the session and the user, then:

1. Rejects users whose `status` is not `active` with `403 ACCOUNT_SUSPENDED`, and deletes the session.
2. Builds the effective role set: explicit `user_roles`, plus `manager` if the linked employee has at least one direct report, plus `employee` if a linked employee exists.
3. If any effective role has `requires_strong_auth` and `strongAuthAt` is NULL, every route except `/auth/me`, `/auth/step-up/*`, `/auth/two-factor/*` (enrolment), `/auth/passkey/*` (enrolment) and `/auth/sign-out` returns `403 MFA_REQUIRED`. The UI then runs step-up.
4. Idle timeout: if `now - session.updatedAt` exceeds `security.session_idle_hours` (8) or, for privileged users, `security.privileged_idle_hours` (1), the session is deleted and the request gets `401 UNAUTHENTICATED`.

`requireFresh` (routes marked **Fresh** in the catalogue) additionally requires `now - strongAuthAt <= 15 min`, else `403 REAUTH_REQUIRED`.

### 3.2 First sign-in of a privileged user

A user with a privileged role who has neither a passkey nor TOTP signs in with an email code, gets `403 MFA_REQUIRED` from every business route, and is guided to enrol a passkey (preferred) or TOTP. Enrolment endpoints are allowed on the weak session. After enrolment, the user completes step-up and continues.

## 4. Invitation flow (FR-AUTH-005, FR-AUTH-009)

1. `POST /users/invitations` (`user.manage`, strong) with `{ email, name, employeeId?, roleCodes? }`: creates `users` row with `status = 'invited'`, links the employee if given (unique, `EMPLOYEE_ALREADY_LINKED` otherwise), assigns roles, creates an `invitations` row with a random 32-byte token (stored as SHA-256), and queues the `invitation` email with link `/accept-invite?token=...`. Expiry 7 days.
2. The user opens the link. The web app calls `GET /auth/invitations/{token}`, which returns the masked email and company name, or `404` for unknown, expired, revoked or used tokens.
3. `POST /auth/invitations/{token}/accept` marks the invitation accepted, sets the user `active`, sets `email_verified = true`, and calls Better Auth's send-OTP for that email. The user enters the code and is signed in.
4. After the first sign-in the UI asks the user to add a passkey (skippable for non-privileged users).

`disableSignUp: true` means an email OTP for an unknown email creates nothing; the send endpoint still returns `200` so attackers cannot test which emails exist.

## 5. Sign-in flows

- **Passkey:** "Sign in with passkey" calls `generate-authenticate-options`, then the browser's WebAuthn API, then `verify-authentication`. Discoverable credentials (resident keys) are used, so the user does not type an email.
- **Email code:** the user enters an email, receives a code, enters it. Only `active` users can complete sign-in (`assertUserMayAuthenticate` hook rejects others).
- `last_login_at` is updated and `user.signed_in` is audited (`AUDIT.md`).

## 6. Account recovery

Replaces SRS FR-AUTH-002 (password reset).

| Situation | Recovery |
|---|---|
| Non-privileged user lost passkey | Sign in with email code; register a new passkey |
| Privileged user lost passkey, still has TOTP | Email code + TOTP step-up; register a new passkey |
| Privileged user lost passkey and authenticator | Email code + a backup code at step-up; then re-enrol |
| Lost everything, or lost access to the email account | An admin with `user.manage` runs `POST /users/{id}/reset-auth` after verifying the person offline. It removes passkeys and TOTP, revokes sessions and audits `user.auth_reset`. The user signs in with an email code and re-enrols. Resetting one's own account is refused |

The Gmail account that sends codes is itself a recovery dependency; its protection is described in `EMAIL.md` section 5.

## 7. Sessions and sign-out

- Cookie `hrm.session_token`: `HttpOnly; Secure; SameSite=Lax; Path=/`. No token is ever readable by JavaScript.
- `POST /auth/sign-out` deletes the current session (FR-AUTH-003). `GET /auth/list-sessions` and `POST /auth/revoke-session` let users end their other sessions.
- Suspending or deactivating a user deletes all their sessions in the same transaction (FR-AUTH-006). `cookieCache` is disabled so the next request is rejected.
- Changing a user's roles keeps sessions but forces the next request to re-evaluate roles (roles are read per request, not cached in the cookie).

## 8. CSRF and origin checks

- Better Auth checks `Origin` against `trustedOrigins` on its own routes.
- Our `csrf` middleware applies the same check to every non-GET `/api/v1/*` route: `Origin` must equal `APP_ORIGIN`, else `403 CSRF_ORIGIN_MISMATCH`. Requests without `Origin` are rejected.
- `SameSite=Lax` cookies are not sent on cross-site `POST`, which is the second layer.
- GET endpoints never change state.

## 9. `/auth/me` and capabilities

`GET /auth/me` returns `CurrentUser` (FR-AUTH-004):

```json
{
  "user": { "id": "...", "email": "rahim@example.com", "name": "Rahim Uddin", "status": "active", "theme": "ink", "locale": "en" },
  "employee": { "id": "...", "employeeCode": "EMP-0012", "name": "Rahim Uddin", "hasDirectReports": true } ,
  "roles": ["hr_admin", "manager", "employee"],
  "permissions": ["employee.read.all", "employee.manage", "leave.request.review.team", "..."],
  "session": { "authMethod": "email_otp", "strongAuth": true, "strongAuthAt": "2026-11-03T04:12:09Z", "mfaRequired": true },
  "enrolment": { "hasPasskey": false, "hasTotp": true }
}
```

- `permissions` is the union of the effective roles' permissions (SECURITY-MODEL section 2). When `mfaRequired` is true and `strongAuth` is false, the response lists only the permissions of non-privileged roles, so the UI does not render screens the API would refuse.
- The web app uses `permissions` for navigation and route guards only; the API checks again on every request.
- `employee` is `null` for users without an employee record (FR-AUTH-009).

## 10. Items to confirm in the Stage 7 spike

| Item | Expected | Fallback |
|---|---|---|
| TOTP enrolment without a password | `twoFactor({ allowPasswordless: true })` lets `enable` run on a session without a credential account | Implement enrolment in our `accounts` module with the `otpauth` library; store the secret encrypted with AES-GCM (Web Crypto) using `BETTER_AUTH_SECRET`-derived key in `two_factors` |
| TOTP step-up on an existing session | Call the plugin's TOTP verification with the current session headers | Verify with the same library against the decrypted secret; HMAC-SHA1 costs well under 1 ms CPU |
| Session additional fields set from hooks | `after` hook can update `strongAuthAt` via `ctx.context.internalAdapter.updateSession` | Store strength in a side table `session_strength(session_id, strong_auth_at)` |

Each spike result is recorded as a decision-log entry before the auth module is built.
