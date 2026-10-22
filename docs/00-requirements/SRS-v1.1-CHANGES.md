# SRS v1.1 changes

SRS v1.1 is SRS v1.0 (`SRS-v1.0.md`) plus the changes in this table. Where this table and SRS v1.0 disagree, this table wins. Each row names the decision that caused the change (`DECISION-LOG.md`). The SRS v1.0 file itself is never edited.

Status values:

| Status | Meaning |
|---|---|
| Changed | Requirement still applies, with the modification shown |
| Superseded | Requirement replaced by a different one |
| Deferred | Moved out of v1 to P1 or later |
| Removed | Not built in v1 and not planned |
| Resolved | An open question in the SRS now has an answer |
| Added | New v1 requirement not in SRS v1.0 |

## 1. Platform and architecture

| Ref | SRS v1.0 | v1.1 status | v1.1 requirement | Decision |
|---|---|---|---|---|
| §2.3 Backend | Python, Django, Django REST Framework | Superseded | TypeScript, Hono on Cloudflare Workers, Zod, OpenAPI generated from route definitions | D-024, D-026, ADR-0001 |
| §2.3 Database | PostgreSQL | Changed | PostgreSQL on Neon Free, reached through Cloudflare Hyperdrive, Drizzle ORM | D-027, ADR-0003 |
| §2.3 Frontend | Vue 3 / Nuxt with TypeScript | Superseded | React 19 single-page app (Vite), TanStack Router/Query/Table, shadcn/ui, Tailwind CSS v4 | D-028, ADR-0005 |
| §2.3 File storage | Private object storage | Changed | Cloudflare R2 private bucket, free tier | D-034, ADR-0009 |
| §2.4, §10.1 | Modular monolith | Changed | Still a modular monolith; module list in `docs/03-architecture/DOMAIN-MODEL.md` adds `reimbursements`, `approvals`, `settings` | D-020 |
| §10.1 Background tasks | Celery + Redis or management commands | Superseded | Postgres outbox table + one Cron Trigger per minute; no Queues | D-036, ADR-0002 |
| §10.1 Email | Transactional email provider | Superseded | Gmail API from a dedicated company Gmail account | D-035, ADR-0007 |
| §10.2, §10.3 | Django and Nuxt folder layouts | Superseded | pnpm + Turborepo monorepo in `docs/03-architecture/MONOREPO.md` | Stage 4 approval |
| §10.4 Environments | Local, CI, staging, production | Changed | Same four, defined in `docs/01-tech-stack/TECH-STACK.md`; all on free tiers | D-032 |
| §10.5 Observability | Logs, monitoring, alerts | Changed | Sentry Developer (free) + Workers Logs | D-031, ADR-0008 |
| New | (none) | Added | **The system must run at $0/month.** Every service uses a free tier; guardrails in ADR-0009 | D-032 |
| §1.5 Hosting | Not specified | Resolved | App served at a `*.workers.dev` address; no company domain | D-035 |
| NFR-PERF-003 | Large jobs run asynchronously | Changed | Heavy work runs as set-based SQL or in the browser (PDF, CSV/XLSX), because Workers Free allows 10 ms CPU per request | D-037, ADR-0009 |
| NFR-OPS-001 | 99.5% availability | Changed | Target only; free tiers carry no SLA | ADR-0009 |
| NFR-OPS-005 | RPO 24 h or better | Changed | Met by nightly encrypted `pg_dump` to R2; Neon Free restore window is only 6 h | ADR-0003 |

## 2. Users, roles and access

| Ref | SRS v1.0 | v1.1 status | v1.1 requirement | Decision |
|---|---|---|---|---|
| §2.2 User classes | Six user classes | Changed | Seven roles: `system_admin`, `hr_admin`, `payroll_officer`, `director`, `auditor`, `manager` (derived from reporting lines), `employee` (derived from the user link) | D-008, SECURITY-MODEL |
| New | (none) | Added | `director` role reads all compensation, payroll and HR reports; may approve payroll | D-008 |
| §6.1 Salary structures | HR: explicit grant only | Changed | `hr_admin` reads salary (`compensation.read.all`) by default but cannot change it | D-008 |
| §6.1 Salary structures | Employee: no access | Changed | Employee reads own salary structure (`compensation.read.own`) | D-008 |
| §6.1 Matrix | Default access matrix | Superseded | Permission catalogue in `docs/03-architecture/SECURITY-MODEL.md` §4 | D-008 |
| FR-PAY-020 | Same person may prepare and approve, exception recorded | Resolved | Allowed; the run is flagged `self_approved` and a justification note is required | D-007 |
| FR-WF-002 | Approver by manager, role or configuration | Resolved | Leave, attendance correction and reimbursement: direct manager; fallback `hr_admin` | D-014 |

## 3. Authentication

| Ref | SRS v1.0 | v1.1 status | v1.1 requirement | Decision |
|---|---|---|---|---|
| FR-AUTH-001 | Secure sign-in | Changed | Passwordless sign-in: passkey (preferred) or one-time code sent by email. No passwords are stored | D-033, ADR-0004 |
| FR-AUTH-002 | Password-reset flow | Superseded | Account recovery: email one-time code; privileged roles also need a recovery code or HR-assisted reset, audited | D-033 |
| FR-AUTH-007 | MFA SHOULD for admins and payroll approvers | Changed | Strong session MUST for `system_admin`, `hr_admin`, `payroll_officer`, `director`, `auditor`: passkey, or email code + TOTP | D-006, D-033 |
| FR-AUTH-008 | Password hashing | Changed | No password hashing (no passwords); one-time codes stored as SHA-256 hashes with expiry and attempt limits | D-033 |
| §8.1 | `/auth/login/`, `/auth/password-reset/…`, `/auth/change-password/` | Superseded | Endpoints in `docs/05-backend/API-CATALOGUE.md` (passkey, email OTP, TOTP, recovery) | D-033 |
| New | (none) | Added | After first sign-in, users are prompted to register a passkey | ADR-0004 |
| New | (none) | Added | Passkeys are bound to the `workers.dev` host; a later move to a custom domain requires re-registration | ADR-0004 |
| New | (none) | Added | Sensitive actions (role change, payroll lock, payment recording) need a sign-in within the last 15 minutes | SECURITY-MODEL §7 |

## 4. Organization and attendance

| Ref | SRS v1.0 | v1.1 status | v1.1 requirement | Decision |
|---|---|---|---|---|
| FR-ORG-001 / §14.1 | Working days to be decided | Resolved | Sunday to Thursday working; Friday and Saturday weekend; configurable per schedule | D-005 |
| §14.2 | Employee ID format | Resolved | `EMP-0001`, auto-incremented, prefix configurable | X-001 |
| FR-ATT-001 | Web check-in | Changed | Allowed from anywhere; IP and user agent stored as evidence only | D-009 |
| FR-ATT-005 / §14.4 | Late arrivals, grace period | Resolved | Flexible hours with a configurable core window and minimum daily hours; lateness is reported, never penalised | D-010 |
| FR-ATT-013 | Overnight and multiple shifts to be defined | Resolved | Single day shift only; work date is the `Asia/Dhaka` date of the check-in; a check-out after midnight flags the record for HR review | D-011 |
| FR-ATT-010 | Overtime SHOULD | Deferred (P1) | No overtime in v1 | D-012 |
| FR-ATT-014 | Corrections after payroll close trigger adjustments | Changed | Low impact in v1: attendance does not affect pay, so no payroll adjustment is created | D-017 |

## 5. Leave

| Ref | SRS v1.0 | v1.1 status | v1.1 requirement | Decision |
|---|---|---|---|---|
| FR-LEAVE-001 / §14.3 | Leave types to be decided | Resolved | Casual, Sick, Annual/Earned, Compensatory, plus HR-defined types; allocations configurable, Bangladesh Labour Act values as seed defaults | D-013 |
| FR-LEAVE-002 | Paid/unpaid classification | Changed | No unpaid leave type in v1; leave never affects salary | D-017 |
| FR-LEAVE-002 | Leave units | Resolved | Full day and half day (first or second half) | D-015 |
| FR-LEAVE-002 | Leave year | Resolved | Calendar year, January to December | D-015 |
| FR-LEAVE-007 | Approval | Resolved | Single step, direct manager; `hr_admin` when no manager; HR may act on behalf (audited) | D-014 |
| FR-LEAVE-012 | Whether pending requests reserve balance | Resolved | Pending requests reserve balance; released on rejection, withdrawal or cancellation | D-016 |
| FR-LEAVE-008 | Encashment where supported | Deferred | No encashment in v1 | D-017 |
| New | Maternity leave | Removed (v1) | Not handled in v1; owner accepted compliance risk; handled outside the system | D-023 |

## 6. Payroll

| Ref | SRS v1.0 | v1.1 status | v1.1 requirement | Decision |
|---|---|---|---|---|
| FR-PAY-001, FR-PAY-002 | Salary structures with earning and deduction components | Changed | One gross monthly amount, effective-dated; ad-hoc addition and deduction lines through adjustments | D-018 |
| FR-PAY-005 | Inputs include attendance and leave | Changed | Inputs are prorated gross, approved reimbursements and approved adjustments only | D-017 |
| §14.5 Proration | To be decided | Resolved | Calendar days: gross × days employed in period ÷ days in month | D-022 |
| FR-PAY-014 | Payment method | Resolved | Cash or cheque; cheque number or cash acknowledgment recorded | D-021 |
| FR-PAY-016 | Arrears, bonuses, loans, advances, reimbursements, final settlement | Changed | Reimbursements (transport) in v1; bonuses, loans and advances deferred; arrears and final settlement only as manual adjustments | D-019, D-020 |
| FR-PAY-017 | Statutory tax rules configurable and verified | Deferred | No income tax (TDS) or Provident Fund in v1; owner accepted compliance risk | D-019, D-023 |
| FR-PAY-013 | Itemized payslips | Changed | Payslip PDF is rendered in the browser from the immutable snapshot | D-037 |
| §11.3 | Required payroll test cases | Changed | Cases that depend on unpaid leave or loan installments do not apply in v1; see `docs/07-quality/PAYROLL-TEST-CASES.md` | D-017, D-019 |

## 7. Reimbursements (new module)

| Ref | v1.1 status | v1.1 requirement | Decision |
|---|---|---|---|
| FR-REIM-001 | Added | Employees submit transport reimbursement claims with date, amount, description and an optional receipt | D-020 |
| FR-REIM-002 | Added | The direct manager approves or rejects; `hr_admin` is the fallback approver | D-014, D-020 |
| FR-REIM-003 | Added | Approved claims are included in the next payroll run and marked paid when the run is paid | D-020 |
| FR-REIM-004 | Added | A claim cannot be edited after submission; the employee may withdraw it while it is pending | DOMAIN-MODEL §5.5 |

## 8. Notifications, UI and documents

| Ref | SRS v1.0 | v1.1 status | v1.1 requirement | Decision |
|---|---|---|---|---|
| FR-WF-007 | In-app and email notifications | Changed | Email only; the approval inbox remains an in-app work queue | D-025 |
| FR-ESS-001 | Dashboard with notices | Changed | No in-app notification centre in v1 | D-025 |
| NFR-UX-005 | Bangla SHOULD | Changed | English in v1; all strings through i18n so Bangla can be added later | D-003 |
| §2.5 | Native apps out of scope | Changed | Native apps are P2; the API must stay client-agnostic | D-004 |
| New | (none) | Added | Ink (dark) theme by default, toggle to Paper (light); preference saved on the user account | D-040 |
| New | (none) | Added | Big-Matrix Solutions brand applied with the app adaptations in `docs/02-brand/APP-UI-ADAPTATION.md`, including `warn` status tokens | D-038, D-040 |
| FR-DOC-004 | File-size limits | Resolved | 10 MB per upload; type allow-list | ADR-0009, ARCHITECTURE §5 |
| §14.9 | Retention periods | Open | Configurable per category; owner must supply periods before go-live | X-003 |

## 9. Still open

These SRS §14 items are not decided. Developers must not invent answers; build them as configuration with no default that implies a policy.

- Document retention periods per category (§14.9, X-003).
- Leave allocation values the company will use (seed defaults follow the Bangladesh Labour Act, but the owner must confirm them).
- Leave carry-forward and expiry limits per leave type.
- Core-hours window and minimum daily hours for the default schedule.
- Holiday list for the first calendar year.
- Who signs off the payroll calculation rules before the first production run (§14.6).
