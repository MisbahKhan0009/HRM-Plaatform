# Auth spike results (Stage 7)

Date: 2026-10-22. Better Auth 1.7.10, `@better-auth/passkey` 1.7.10, Drizzle 0.45, postgres-js 3.4, Postgres 16. Code: `packages/auth/src/create-auth.ts`, test `packages/auth/src/spike.test.ts` (run with `AUTH_SPIKE_DATABASE_URL=… pnpm --filter @hrm/auth test`).

## Questions from AUTH-IMPLEMENTATION.md §10 and the answers

| Question | Result |
|---|---|
| Can TOTP be enabled without a password? | **Yes.** `twoFactor({ allowPasswordless: true })` enables and verifies TOTP for users with no credential account. Tested end to end. |
| Does invite-only email OTP work? | **Yes.** `emailOTP({ disableSignUp: true })` signs in existing users only; an unknown email gets no session. OTPs are stored hashed (`storeOTP: 'hashed'`), 10 min expiry, 5 attempts. |
| Does it run in the Workers runtime? | **Yes.** In `wrangler dev` (workerd) Better Auth + Drizzle + postgres-js reached Postgres over TCP: `/ok`, OTP send (200) and wrong-OTP rejection (`INVALID_OTP`) all behave. |
| Bundle size with auth included | 3.8 MB raw, **665 KiB gzip**. Within the 2 MB guardrail (ADR-0009), but auth is now most of the bundle. |
| Rate limiting | Works with `storage: 'database'`: the 4th OTP request from one IP inside the window returned **429**. Counters persist in `rate_limits`. |
| Password hashing | Never runs: `emailAndPassword` is disabled, so the scrypt cost that motivated D-033 is gone. |
| Passkeys | Configured (`rpID` = app host). Registration and assertion need a browser authenticator, so they are covered by a Playwright test with a virtual authenticator in Stage 8. Verification uses WebCrypto ECDSA, which is cheap. |

## CPU per request

Measured in Node 22 with `process.cpuUsage()` around `auth.handler()`, warm, against local Postgres, 30 users per run, two runs. Node is a stand-in: Workers CPU is not measurable locally. The numbers include Better Auth, Drizzle and postgres-js work; time spent waiting on the database is not counted, matching how Workers counts CPU.

| Endpoint | Median | Max | Frequency |
|---|---|---|---|
| `GET /get-session` (with 60 s cookie cache) | **2.9 ms** | 9.9–12.5 ms | every authenticated request |
| `GET /get-session` (no cookie cache) | 3.9–4.1 ms | 13.5–15.6 ms | — |
| `POST /email-otp/send-verification-otp` | 4.1–4.3 ms | 15.7–16.1 ms | once per sign-in |
| `POST /sign-in/email-otp` | 10.2–10.4 ms | 24–27 ms | once per sign-in |
| `POST /two-factor/enable` | 5.8–6.2 ms | 17.8–22.7 ms | once per user |
| `POST /two-factor/verify-totp` | 10.2–10.4 ms | 18.6–20.4 ms | once per strong sign-in |

## Conclusions

1. **The hot path fits.** Session checks on ordinary API requests are about 3 ms median with the cookie cache. This is the request that runs thousands of times a day.
2. **Sign-in steps are borderline.** `sign-in/email-otp` and `verify-totp` sit at about 10 ms median in Node. They run once per sign-in. The real Workers numbers must be read from Workers Logs (`cpuTime`) on staging right after the first deploy. This is a **go-live gate** in `docs/08-operations/GO-LIVE-CHECKLIST.md`.
3. **If Workers shows these endpoints over the limit** (error 1102), apply in this order:
   a. make **passkeys the default** strong factor for privileged roles (one cheap WebCrypto signature check instead of OTP + TOTP);
   b. profile `verify-totp` and `sign-in` with `wrangler dev --inspect`, and replace any pure-JS crypto on those paths through Better Auth hooks;
   c. only if both fail: the owner decides between keeping TOTP and the $5/month Workers Paid plan. This would be the only exception to D-032 and needs a new decision.
4. **Session cache trade-off:** a signed cookie cache means a revoked session can still pass Better Auth's own check for up to 60 s. Our authorization middleware loads the user's status and roles from the database on every request, so a suspended or deactivated user is rejected immediately (FR-AUTH-006). Recorded as D-044.

## Schema alignment done

The generated Better Auth schema was aligned with DATA-MODEL.md §2: `uuid` ids (generated with `uuidv7()`), `citext` email, `timestamptz` columns. Migration `0002_identity.sql`. Better Auth's own child tables (`sessions`, `accounts`, `passkeys`, `two_factors`) keep `ON DELETE CASCADE`; users are never deleted, only deactivated (FR-SET-003), so this cannot remove business history.

## Follow-ups for Stage 8

- Add the user fields from DATA-MODEL §2 (status, theme, locale) as Better Auth `additionalFields`, and the `created_by`/`updated_by` foreign keys to `users`.
- Wire `/api/v1/auth/*` in `apps/api` with the Hyperdrive connection string; add the strong-session flag and step-up endpoints.
- Playwright passkey test with a virtual authenticator.
