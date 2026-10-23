# Risk register

Known risks to delivery and operation, with their mitigation and owner. Review it at the end of every delivery phase and before go-live. Likelihood and impact are High (H), Medium (M) or Low (L).

Owner roles: **PO** = product owner (company owner), **Lead** = lead developer, **Ops** = whoever holds the production accounts (initially the lead developer).

## Inherited from SRS §13

| ID | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| R-01 | Incorrect payroll calculation | M | H | v1 rules are simple (D-017, D-019); domain rules unit-tested with property-based tests; every case in `docs/07-quality/PAYROLL-TEST-CASES.md` approved independently before the first production run | Lead + PO |
| R-02 | Unauthorized access to salary or documents | M | H | Server-side permission and scope checks; 404 for out-of-scope records; IDOR test suite; private R2; access audit | Lead |
| R-03 | Duplicate payroll processing | L | H | Unique constraints per period and run type; idempotency keys; state machine | Lead |
| R-04 | Incorrect leave balances | M | M | Ledger is authoritative; atomic approval; `FOR UPDATE` locking; concurrency tests | Lead |
| R-05 | Historical records overwritten | L | H | Effective-dated records; immutable snapshots; no hard deletes | Lead |
| R-06 | Data loss | M | H | Nightly encrypted backup to R2; quarterly restore drill (see R-12) | Ops |
| R-07 | Scope expansion | H | M | `docs/00-requirements/SCOPE-V1.md`; new work needs a decision-log entry | PO |
| R-08 | Dependency on one administrator | H | H | See R-17 | PO |
| R-09 | Notification failures | M | L | Outbox with retries; failure never rolls back business state; dead messages on the health page | Lead |
| R-10 | Unclear HR policy | H | M | Open questions listed in `SRS-v1.1-CHANGES.md` §9; values stay configurable; no invented policy | PO |

## New risks from v1 decisions

| ID | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| R-11 | Free-tier limits exceeded: Workers 10 ms CPU or 100,000 requests a day, Neon 100 CU-hours or 0.5 GB, R2 10 GB, GitHub Actions 2,000 minutes | M | H | Guardrails in ADR-0009; bundle-size CI check; monthly usage review in `docs/08-operations/FREE-TIER-MONITORING.md`; documented paid upgrade path if the owner ever approves one | Ops |
| R-12 | Neon Free keeps only 6 hours of restore history | H | M | Nightly `pg_dump` encrypted with `age` to R2 is the real backup; restore drill before go-live and quarterly | Ops |
| R-13 | Gmail rate-limits or flags automated mail, blocking sign-in codes and approvals | M | H | Low volume; dedicated account with 2FA; passkeys reduce reliance on email; `Mailer` interface allows a provider swap when a domain exists | Lead |
| R-14 | R2 requires a payment card on file; usage above the free tier would be charged | L | M | 10 MB upload cap, client-side image compression, backup rotation; monthly R2 usage check | Ops |
| R-15 | Passkeys are bound to the `workers.dev` host; moving to a custom domain invalidates them | M | L | Email codes still work; plan re-registration as part of any domain move | Lead |
| R-16 | Legal non-compliance: TDS and maternity leave not handled in v1 (D-023) | H | H | Owner accepted the risk; handled outside the system; data model allows adding them; review with a local adviser before go-live | PO |
| R-17 | Single developer (bus factor of one) | H | H | Complete docs; `AGENTS.md`; second admin holds production account access; credentials in a shared password manager | PO |
| R-18 | Email provider changed: Cloudflare Email Service (paid only) replaced by Gmail API | L | L | Decided in ADR-0007; `Mailer` interface isolates the provider | Lead |
| R-19 | Neon cold start after 5 minutes idle adds about 1 second to the first request | H | L | Accepted and documented as a known limit; no keep-warm pings, because they would use up Neon compute hours | Lead |
| R-20 | Free tiers have no SLA; outages at Cloudflare, Neon or Google stop the app | M | M | 99.5% is a target only; incident runbooks; manual fallback (paper attendance) for long outages | Ops |
| R-21 | Third-party agent skills change or contain unsafe instructions | L | M | Skills pinned in `skills-lock.json`; every update reviewed before commit (`docs/SKILLS.md`) | Lead |
| R-22 | Free service terms change (a free tier is reduced or removed) | M | M | ADR-0009 lists each dependency; quarterly check of provider terms; portable architecture (Postgres, plain TypeScript domain) | Ops |
