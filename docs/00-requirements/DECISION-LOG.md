# Requirements Decision Log

Each decision taken during requirements analysis. IDs are stable — reference them
in ADRs, docs and code comments (e.g. `see D-001`).

| ID | Topic | Decision | Impact | Date |
|---|---|---|---|---|
| D-001 | Product type | Internal single-company v1, **SaaS-ready** design | No tenant logic in v1, but avoid hard-coded single-company assumptions (company settings in DB, no global singletons in business logic, org-scoped queries isolated in one layer) so a `tenant`/`company` scope can be added later | 2026-10-22 |
| D-002 | Team & timeline | 1–2 developers + AI assistance, ~3 months to v1 | Keep stack lean; heavy reliance on docs, conventions and automated checks; follows SRS 12-week phase plan | 2026-10-22 |
| D-003 | Language | English v1, **Bangla-ready** | All UI strings via i18n from day one; backend messages translatable; dates/numbers via locale formatters | 2026-10-22 |
| D-004 | Mobile | Responsive web v1; **native apps later (P2)** | API must be client-agnostic: token-capable auth alongside browser sessions, no web-only assumptions in API responses | 2026-10-22 |
| D-005 | Work week | **Sun–Thu** working, Fri + Sat weekend; working days configurable per schedule | Default schedule seed; holiday/working-day calc uses schedule | 2026-10-22 |
| D-006 | Authentication | ~~Email + password~~ → superseded by **D-033 (passwordless)**. Strong second factor still **mandatory** for System Admin, HR Admin, Payroll/Finance, Director and Auditor roles (Auditor added 2026-10-22: it reads salary data) | MFA-required enforcement by role | 2026-10-22 |
| D-007 | Payroll separation of duties | Same person **may** prepare and approve, but the system flags it, requires a justification note, and audits it (FR-PAY-020) | Approval step stores `self_approved` flag + note | 2026-10-22 |
| D-008 | Compensation visibility | Payroll/Finance: manage. HR Admin: read. **New role "Director"**: read all compensation. Employee: read **own** salary structure (not only payslips). System Admin: none | Adds a 7th user class (Director); field-level permission `compensation.read` separate from `employee.read` | 2026-10-22 |
| D-009 | Check-in location | Web check-in from **anywhere, no restriction**. IP and user-agent captured as evidence metadata only | No geofence/IP allow-list in v1 | 2026-10-22 |
| D-010 | Attendance policy | **Flexible hours with core hours** (configurable core window + minimum daily hours). Lateness is reported only, never penalised | Attendance status = present / short-hours / missed-core / absent / missing-punch; no late-to-leave rules | 2026-10-22 |
| D-011 | Shifts | **Single day shift only**; no overnight shifts in v1 | Resolves FR-ATT-013: work date = `Asia/Dhaka` date of check-in; a check-out after midnight is flagged for review | 2026-10-22 |
| D-012 | Overtime | **No overtime in v1** | FR-ATT-010 moved to P1 | 2026-10-22 |
| D-013 | Leave types | Casual, Sick, Annual/Earned, Compensatory + HR-defined custom types. Allocations configurable (BD Labour Act values as seed defaults) | Leave-type config must be data-driven | 2026-10-22 |
| D-014 | Leave approval | **Manager only** (single step). If no manager is assigned, HR is the approver. HR may act on behalf (audited) | Approval engine v1 = single step, but modelled as steps for future multi-step | 2026-10-22 |
| D-015 | Leave year & units | **Calendar year (Jan–Dec)**; full day and half day (first/second half) | Carry-forward/expiry processed at year end | 2026-10-22 |
| D-016 | Pending leave | Pending requests **reserve** balance; released on reject/cancel (FR-LEAVE-012) | Ledger has a `reservation` entry type | 2026-10-22 |
| D-017 | Leave ↔ payroll | **Leave never affects salary.** No unpaid leave type in v1. Attendance does not affect salary either | Payroll does not consume attendance/leave inputs in v1 → large reduction in payroll complexity; FR-ATT-014 becomes low-impact | 2026-10-22 |
| D-018 | Salary structure | **Single gross monthly amount**, effective-dated, plus ad-hoc addition/deduction lines | `salary_structures` holds one gross figure; components table kept generic for future | 2026-10-22 |
| D-019 | Statutory deductions & benefits | **No** income tax (TDS), Provident Fund, loans/advances or festival bonuses in v1. Manual adjustment lines (addition/deduction with reason + approval) remain | FR-PAY-016/017 deferred; data model stays extensible | 2026-10-22 |
| D-020 | Transport cost | **Claim-based reimbursement**: employee submits claim (+ optional receipt), manager approves, approved claims paid in next payroll run | Pulls a scoped "reimbursement claims" module from P1 into v1 | 2026-10-22 |
| D-021 | Payment method | **Cash / cheque**. Record cheque number or cash acknowledgment, date, status; reconcile | No bank file export in v1 | 2026-10-22 |
| D-022 | Proration | **Calendar days**: gross ÷ days in month × days employed | Deterministic, decimal arithmetic, rounding rule to be documented | 2026-10-22 |
| D-023 | Compliance scope | TDS and maternity leave **not** handled in v1 (owner decision). They must be handled outside the system; recorded as an accepted compliance risk | Risk register entry; model must allow adding them without migration pain | 2026-10-22 |
| D-024 | Hosting | **Cloudflare Workers** for both frontend and backend | SRS stack (Django) cannot run on Workers → stack re-selection in Stage 2 | 2026-10-22 |
| D-025 | Notifications | **Email only** at launch (no in-app notification centre). The approval inbox remains an in-app work queue | FR-WF-007 in-app part deferred; email sent async; failure never rolls back business state (FR-WF-008) | 2026-10-22 |

## Defaults applied without a question (configurable, change any time)

| ID | Topic | Default |
|---|---|---|
| X-001 | Employee code | `EMP-0001` format, auto-incremented, prefix configurable |
| X-002 | Currency / timezone | BDT, `Asia/Dhaka` (SRS) |
| X-003 | Document retention | Configurable per category; actual periods must be supplied by the owner before go-live (SRS §14.9) |
| X-004 | Money handling | Stored as `NUMERIC(14,2)` (or integer poisha); half-up rounding to 2 decimals at line level |

## Still open

- Document retention periods (before go-live): owner to supply (C5).

## Stage 2 — stack decisions

| ID | Decision | Record |
|---|---|---|
| D-026 | Backend: TypeScript + Hono + Zod/OpenAPI on Workers | ADR-0001 |
| D-027 | Database: PostgreSQL on Neon via Hyperdrive, Drizzle ORM | ADR-0003 |
| D-028 | Frontend: React SPA (Vite) + TanStack + shadcn/ui | ADR-0005 |
| D-029 | Auth: Better Auth (passwordless config, see D-033) | ADR-0004 |
| D-030 | ~~Email: Cloudflare Email Service~~ → superseded by D-035 (requires Workers Paid) | ADR-0007 |
| D-031 | Monitoring: Sentry + Workers Logs | ADR-0008 |

## Stage 2b — zero-cost constraint

| ID | Decision | Record |
|---|---|---|
| D-032 | **Everything must run on free tiers — no paid plans, ever.** Every service choice must have a free tier that covers <50 employees with headroom | ADR-0009 |
| D-033 | **Passwordless login**: passkeys (preferred) or email one-time code. Privileged roles must hold a strong factor: passkey, or email code + TOTP authenticator. No passwords stored (avoids 10 ms CPU limit and password leaks). SRS FR-AUTH-002 (password reset) becomes "account recovery" | ADR-0004 |
| D-034 | Files in **Cloudflare R2** free tier (10 GB). A card is kept on file for verification only; usage must stay within free limits | ADR-0009 |
| D-035 | **No company domain.** App served at a free `*.workers.dev` address; email sent through a dedicated company **Gmail account via the Gmail API** (free, ~500/day) | ADR-0007 |
| D-036 | No Cloudflare Queues; async work uses a **Postgres outbox table**, sent right after commit via `ctx.waitUntil`, retried by a Cron every 15 min in Dhaka working hours, plus one daily dispatcher Cron. *(Revised 2026-10-22: a per-minute cron would exhaust Neon's free compute.)* | ADR-0002 |
| D-037 | PDF payslips and XLSX/CSV exports are **generated in the browser** from immutable server data, keeping Worker CPU under the free limit | ADR-0006 |
| D-038 | Company & brand: **Big-Matrix Solutions** design system (owner's design-system artifact), snapshot in `docs/02-brand/source/` | docs/02-brand |
| D-039 | AI skills: only free third-party skills from GitHub / skills.sh, reviewed before commit; no self-made skills | docs/SKILLS.md |
| D-040 | App UI: brand adapted for product use; **Ink (dark) default with a toggle to Paper (light)**; dot grid + glow only on brand moments; adds `warn` status tokens | docs/02-brand/APP-UI-ADAPTATION.md |
| D-041 | Mid-month salary change: **split-period proration** (old gross for days before the effective date, new gross from it, each prorated by calendar days) | BUSINESS-RULES §6.3 |
| D-042 | **All proposed defaults in `OPEN-QUESTIONS.md` accepted** (2026-10-22), including leave seed values (Casual 10, Sick 14, Earned 1 per 18 days worked), core hours 10:00–16:00 with 8 h minimum, inclusive join/separation days, one payment per payroll item, 20% net-change warning, 7-day correction window, 12-hour time, no company directory, team leave calendar off, weekly R2 document backup to the dedicated Google Drive, Worker name `hrm`. Values remain editable in settings; leave values to be checked by an adviser | OPEN-QUESTIONS.md |
| D-043 | GitHub repository is **public**: free branch protection, environments with required reviewers, unlimited Actions minutes; strict no-secrets / no-real-data rule | CI-CD.md, ACCOUNT-SETUP.md |
| D-044 | Better Auth **session cookie cache 60 s** (keeps the per-request session check at about 3 ms CPU); the authz middleware reads user status + roles on every request so suspension is still immediate. Real Workers CPU for sign-in endpoints is a go-live gate | docs/05-backend/AUTH-SPIKE.md |
| D-045 | **Sign-in factor changes and passkey step-up.** Adding the first passkey or authenticator is allowed on a session signed in within the last 15 minutes; once a factor exists, adding, removing or replacing one needs strong auth within the last 15 minutes (`REAUTH_REQUIRED`). Passkey step-up is a passkey sign-in that replaces the weak session with a strong one. TOTP step-up (`POST /auth/step-up/totp`) forwards to Better Auth so its code checks and rate limits apply | Stops an attacker who holds only the email inbox from adding a factor to an account that already has one | docs/05-backend/AUTH-IMPLEMENTATION.md §3 |
| D-046 | **Database driver: postgres-js with a one-line patch** (`patches/postgres@3.4.9.patch`) to its Workers socket polyfill, which threw an unhandled rejection when a connection closed. node-postgres was tried and does not load in the Workers test runtime. Remove the patch when upstream fixes it | Clean connection shutdown in Workers and tests | patches/ |
| D-047 | **SPA initial-JS budget (PB-06) stays at 200 KB gzip; the CI check reports without failing until the gap closes.** `apps/web/scripts/check-bundle-size.mjs` counts the entry chunk plus every statically imported chunk of the sign-in and dashboard routes. On 2026-10-23 that measured 215 KB (sign-in) and 219 KB (dashboard). Most of the remainder is zod (about 25 KB), pulled in by route search validation and by `@hrm/contracts` enum imports. Closing it needs zod-free enum modules in contracts and lighter route search validation. Make the CI step blocking again once both routes measure at or under 200 KB | A failing gate on every build hides new regressions; a reporting gate keeps the number visible | docs/07-quality/PERFORMANCE-BUDGETS.md |
| D-048 | **Only a system admin can change a system admin's account.** Suspending, reactivating, deactivating or resetting the sign-in methods of a user who holds `system_admin` needs `role.manage`; `user.manage` alone (HR admin) gets 403. A system admin can still do these actions to HR admins. Owner answer to C13, 2026-10-23 | Stops an HR admin account, or someone who has taken one over, from locking out or taking over the technical administrator | OPEN-QUESTIONS.md C13, API-CATALOGUE §2 |
| D-049 | **Remaining owner questions settled by industry-standard practice** (owner instruction, 2026-10-23). The written v1 behaviour or proposed default is the decision for BUSINESS-RULES questions 1 to 28 and the design-document questions, except: off-cycle runs pay approved claims and adjustments only (BUSINESS-RULES 6.10, questions 6 and 23, A5); the CSV import creates existing staff as `active` or `probation` with their historical joining date (BUSINESS-RULES §10, question 21); a cheque bounced after the run is `paid` is reissued as an `addition` adjustment (question 28); a role without strong auth may hold only the default manager and employee permissions (C11); documents are never deleted automatically until legal advice sets retention periods (C5) | Closes every open policy question so go-live depends only on owner data (A7, B8, C9) | BUSINESS-RULES.md, OPEN-QUESTIONS.md |
