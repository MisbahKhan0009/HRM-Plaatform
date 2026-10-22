# Threat model

Status: **Accepted**, 2026-10-22; review at every release that changes a trust boundary, and at least yearly. Method: STRIDE per component and data flow. Architecture: `docs/03-architecture/ARCHITECTURE.md`. Controls: `docs/03-architecture/SECURITY-MODEL.md`. Tests: `SECURITY-TESTING.md`.

## 1. Assets

| ID | Asset | Sensitivity | Where it lives |
|---|---|---|---|
| A-1 | Salary structures, payroll items, payslips, payments | High (financial, confidential) | Postgres (`payroll` tables) |
| A-2 | National ID numbers, personal contact, emergency contacts | High (personal data) | Postgres (`employee_contacts`) |
| A-3 | Employee documents (contracts, IDs, certificates, receipts) | High | R2 private bucket |
| A-4 | Sessions, passkeys, TOTP secrets, OTP hashes | Critical (account takeover) | Postgres (Better Auth tables) |
| A-5 | Audit log | High (integrity, evidence) | Postgres `audit_logs` |
| A-6 | Leave and attendance records | Medium | Postgres |
| A-7 | Database backups | High (all of the above) | R2 backup bucket, `age`-encrypted |
| A-8 | Platform credentials: Cloudflare API token, Neon connection strings, Gmail refresh token, `BETTER_AUTH_SECRET`, backup key | Critical | Worker secrets, GitHub secrets, owner's offline store |
| A-9 | The dedicated Gmail account | Critical (it delivers every sign-in code) | Google |

## 2. Trust boundaries

```text
TB-1  Internet / browser      ⇄  Cloudflare Worker (HTTPS)
TB-2  Worker                  ⇄  Neon Postgres (via Hyperdrive, TLS)
TB-3  Worker                  ⇄  R2 (binding)
TB-4  Worker                  ⇄  Gmail API (HTTPS, OAuth)
TB-5  GitHub Actions          ⇄  Cloudflare / Neon / R2 (deploy, migrate, backup)
TB-6  Operators (dashboards)  ⇄  Cloudflare, Neon, Google, Sentry, GitHub accounts
TB-7  Worker / browser        ⇄  Sentry (error events)
```

Inside TB-1, roles form logical boundaries: employee ⇄ manager ⇄ HR ⇄ payroll ⇄ director.

## 3. STRIDE analysis

| ID | Component / flow | Threat | STRIDE | Mitigation | Test |
|---|---|---|---|---|---|
| T-01 | Sign-in (TB-1) | Attacker requests OTPs for a victim and guesses codes | S | 6-digit OTP, short expiry, 5 attempts then invalidated, rate limits per email and IP; passkeys preferred | AUTH-02, AUTH-03 |
| T-02 | Sign-in | Attacker controls the victim's mailbox | S | Privileged roles also need TOTP or a passkey (D-006, D-033); sign-in notification email | AUTH-08 |
| T-03 | Session (TB-1) | Cookie theft via XSS | S, I | `HttpOnly` cookie; React escaping; strict CSP; no `dangerouslySetInnerHTML` (lint rule) | WEB-04, WEB-05 |
| T-04 | Session | CSRF on state-changing routes | T | `SameSite=Lax` + `Origin` check on all non-GET requests | WEB-01, WEB-02 |
| T-05 | API (TB-1) | Employee reads another employee's payslip/documents by changing an ID (IDOR) | I | Scope check in every policy; 404 for out-of-scope; generated matrix test | §3 matrix |
| T-06 | API | Manager accesses employees outside their reporting tree | I | Recursive `team` scope computed server-side | §3 matrix |
| T-07 | API | Self-approval of leave/claims, or privilege self-grant | E | `SELF_APPROVAL_FORBIDDEN`; `role.manage` required; audited | §3 escalation |
| T-08 | API | Mass assignment of `status`, `salary`, `roles` | T, E | Strict Zod schemas; dedicated action endpoints for state changes (SRS §8.7) | WEB-07 |
| T-09 | Payroll | Locked payroll silently changed | T | State machine; DB check + service guard; adjustments only; audit | PAY-10 |
| T-10 | Payroll | Duplicate run or duplicate payment from retries | T | Unique constraints, idempotency keys, row locks | PAY-08 |
| T-11 | Uploads (TB-3) | Malicious file served to HR/employees | T, E | Type allow-list + magic bytes, size cap, `attachment` + `nosniff`, private bucket | UP-01…08 |
| T-12 | Downloads (TB-3) | Permanent public URL leaks a document | I | No public bucket; authorized streaming endpoint; signed URLs (if ever used) ≤ 5 min | UP-08 |
| T-13 | Audit (TB-2) | Actor deletes evidence | R, T | App role has no UPDATE/DELETE on `audit_logs`; no API to change it | AUD-01, AUD-02 |
| T-14 | Logs / Sentry (TB-7) | Personal or salary data leaks into logs or Sentry | I | No PII in logs; Sentry `beforeSend` scrubbing; `sendDefaultPii: false` | `docs/08-operations/OBSERVABILITY.md` §4 |
| T-15 | Email (TB-4) | Gmail refresh token stolen → attacker sends mail as the company | S | Token only as Worker secret; scope `gmail.send` only; account 2FA; rotation | `docs/08-operations/SECRETS.md` |
| T-16 | Email | Gmail account lost or locked → nobody can sign in | D | Passkeys don't need email; recovery codes for admins; documented recovery owner | `docs/08-operations/INCIDENT-RUNBOOKS.md` IR-04 |
| T-17 | CI/CD (TB-5) | Malicious PR exfiltrates deploy secrets | E, I | No `pull_request_target`; secrets only in protected environments; actions pinned to SHAs; least-privilege `permissions` | `docs/08-operations/CI-CD.md` §6 |
| T-18 | CI/CD | Compromised npm dependency | T, E | Lockfile, `pnpm audit`, OSV, review of new deps, Dependabot, no install scripts by default (`pnpm` `onlyBuiltDependencies` allow-list) | SECURITY-TESTING §8 |
| T-19 | Backups (A-7) | Backup file stolen from R2 | I | `age` encryption before upload; private key not in the backup bucket; scoped R2 token | BACKUP-AND-RESTORE |
| T-20 | Operator accounts (TB-6) | Takeover of Cloudflare/Neon/GitHub/Google account | E | 2FA on every account, two named owners, API tokens scoped and listed in SECRETS.md | ACCOUNT-SETUP |
| T-21 | Availability (TB-1/TB-2) | Free-tier limit reached (CPU 1102 errors, Neon compute suspended, daily request cap) | D | ADR-0009 guardrails; FREE-TIER-MONITORING monthly checks; alerting | INCIDENT-RUNBOOKS IR-02, IR-03 |
| T-22 | Availability | Request flooding the API or OTP sender | D | Cloudflare edge protection; app rate limits on auth and sensitive routes; Gmail daily cap protects against mail flooding | AUTH-02 |
| T-23 | Data in non-prod | Real employee data copied to staging | I | Anonymisation script required; staging uses synthetic seed (NFR-SEC-009) | GO-LIVE-CHECKLIST |
| T-24 | Repudiation | Approver denies approving a payroll run | R | Immutable approval steps with actor, time, strong-session flag; self-approval note (D-007) | AUD-04 |

## 4. Residual risks (accepted or open)

| ID | Risk | Status | Owner action |
|---|---|---|---|
| R-01 | Free tiers have no SLA; outages at Cloudflare, Neon or Google stop the app | Accepted (D-032) | Upgrade path in `docs/08-operations/FREE-TIER-MONITORING.md` §5 |
| R-02 | Sign-in depends on one Gmail account when users have no passkey | Accepted; mitigated by passkey prompt after first sign-in | Keep two recovery owners for the Gmail account |
| R-03 | Passkeys bound to `*.workers.dev`; moving to a custom domain needs re-registration | Accepted (ADR-0004) | Plan the move as a migration |
| R-04 | No malware scanning of uploads (no free in-Worker scanner) | Accepted for v1 | Revisit if uploads from outside the company are ever allowed |
| R-05 | TDS and maternity leave handled outside the system | Accepted compliance risk (D-023) | Owner and legal adviser |
| R-06 | Neon Free restore window is 6 hours; backups are nightly | RPO ≤ 24 h meets NFR-OPS-005 | Restore drill quarterly |
| R-07 | Single-region database (Singapore) | Accepted | — |
