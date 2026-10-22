# ADR-0004: Better Auth, passwordless (passkeys + email OTP) with MFA for privileged roles

- Status: Accepted (2026-10-22, revised for D-032/D-033)

## Context
Workers Free allows 10 ms CPU per request. Secure password hashing (scrypt/Argon2/PBKDF2 at recommended strength) exceeds that. Stored passwords are also the main leak risk for an HR system.

## Decision
**Better Auth** with the Drizzle adapter, configured **without passwords**:
- **Passkeys (WebAuthn)** — preferred sign-in; phishing-resistant; verification is a cheap signature check.
- **Email one-time code** (OTP) — fallback and first-time sign-in; codes stored hashed (SHA-256), short expiry, attempt limits.
- **TOTP authenticator + recovery codes** for privileged roles.
- Sessions in Postgres; cookies HttpOnly, Secure, SameSite=Lax; logout revokes session.

Application rules on top:
- Privileged roles (System Admin, HR Admin, Payroll/Finance, Director) must authenticate with a **passkey**, or **email OTP + TOTP**; otherwise access to privileged routes is blocked (D-006). Enforced in our middleware with a `strong_auth` flag on the session; plugin interplay verified in the Stage 7 spike.
- Invite-only (FR-AUTH-005); suspended/deactivated users cannot sign in and sessions are revoked (FR-AUTH-006).
- FR-AUTH-002 "password reset" becomes **account recovery**: email OTP + (for privileged roles) recovery code or HR-assisted reset, audited.
- **Authorization (RBAC + record scope) is our own code** (SRS §6).
- Passkeys are bound to the hostname (`*.workers.dev`). Moving to a custom domain later requires re-registering passkeys (email OTP keeps users unblocked).

## Consequences
+ No password storage; fits the free CPU budget.
− Sign-in depends on email delivery when no passkey is registered (ADR-0007). Users are prompted to add a passkey after first login.
