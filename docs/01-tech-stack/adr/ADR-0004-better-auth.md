# ADR-0004: Better Auth for authentication and MFA

- Status: Accepted (2026-10-22)

## Decision
Use **Better Auth** with the Drizzle adapter: email/password (framework hashing), password reset, session revocation on logout, TOTP two-factor with recovery codes, rate limiting on auth routes. Sessions stored in Postgres; cookies HttpOnly, Secure, SameSite=Lax.

Application-level rules on top:
- MFA **required** for System Admin, HR Admin, Payroll/Finance and Director roles (D-006); access is blocked until enrolled.
- Suspended/deactivated users cannot authenticate and their sessions are revoked (FR-AUTH-006).
- Invite-only: no public sign-up (FR-AUTH-005).
- **Authorization (RBAC + record scope) is our own code**, not Better Auth: roles → permissions → policy functions checked on every request (SRS §6).
- Bearer/token support reserved for future native apps (D-004).

## Consequences
+ Security-critical crypto/session code is maintained upstream; data stays in our DB.
− Must track Better Auth releases and pin versions.
