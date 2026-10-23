# Version 1 scope

Version 1 is the release that goes to production for Big-Matrix Solutions staff. It contains every module in section 1, built to SRS v1.1 (`SRS-v1.0.md` + `SRS-v1.1-CHANGES.md`). Anything in section 2 waits for a later release and needs an owner decision before work starts.

Delivery assumes one to two developers with AI assistance over about 12 weeks (D-002), following the plan in section 3.

## 1. In scope, per module

| Module | In v1 | Not in v1 (deferred) |
|---|---|---|
| `accounts` | Invite-only accounts; passkey and email one-time-code sign-in; TOTP and recovery codes; strong-session enforcement for privileged roles; suspend, reactivate, deactivate; role assignment; theme preference | Native-app token auth (P2), SSO (not planned) |
| `organization` | Company settings (name, logo, timezone, currency), departments, positions, reporting manager with cycle detection, work schedules, holidays | Multiple companies / tenants (D-001: design allows it later) |
| `employees` | Create, edit, archive; employee code `EMP-0001`; effective-dated employment events; contracts; restricted contact data; search, filter, sort, pagination; CSV import with preview and error report; profile change requests | Onboarding and offboarding checklists (P1) |
| `attendance` | Web check-in and check-out; daily records with flexible core-hours status; corrections with manager approval; manual entries by HR; daily and monthly reports | Overtime (P1, D-012), biometric devices (P2), geofencing (not planned, D-009), overnight shifts (D-011) |
| `leave` | Leave types and effective-dated policies; ledger with reservation, usage, adjustment, reversal, accrual, carry-forward, expiry; full and half days; single-step manager approval; cancellation; team calendar | Unpaid leave (D-017), maternity leave (D-023), encashment, multi-step approval |
| `payroll` | Gross salary structures with effective dates; monthly periods and runs; calendar-day proration; approved reimbursements and adjustments; validation; submit, approve (self-approval flagged), lock; cash and cheque payment records; reconciliation; payslips | Income tax (TDS) and Provident Fund (D-019, D-023), loans, advances, festival bonuses, bank transfer files (D-021) |
| `reimbursements` | Transport claims with optional receipt; manager approval; payment through the next payroll run | Other claim categories and general expenses (P1) |
| `documents` | Private upload against an employee, categories, issue and expiry dates, versions with checksums, authorized download, access audit, expiry reminders to HR | Malware scanning (no free option chosen yet), e-signatures |
| `approvals` | Approval inbox per approver; approve and reject with comment; immutable decision history | Delegation (`/approvals/{id}/delegate/`), multi-step chains |
| `notifications` | Email through the outbox for invitations, sign-in codes, submissions, decisions, reminders | In-app notification centre (D-025), SMS |
| `reports` | Headcount, directory, attendance, leave, payroll register, reimbursement and payment reconciliation reports; CSV and XLSX export built in the browser | Scheduled reports, PDF reports |
| `audit` | Append-only audit log; search by date, actor, action, entity | Export to external SIEM |
| `settings` | Technical, HR and payroll settings with history; system health page (jobs, outbox, last backup) | (none) |
| UI | Responsive web, Ink theme by default with Paper toggle, English with i18n keys | Bangla translation (later), PWA, native apps (P2) |

## 2. Out of scope for v1

From SRS §2.5, unchanged: multi-tenant SaaS billing, recruitment and applicant tracking, learning management, automated bank disbursement, biometric hardware, native apps, AI-based decisions about people, workforce planning.

Added by decisions: overtime (D-012), unpaid leave (D-017), statutory tax and Provident Fund (D-019), maternity leave (D-023), in-app notifications (D-025), any paid service (D-032).

## 3. Delivery plan

The SRS §12 phases, adjusted for the decisions. Phase 3 is shorter than in the SRS because payroll no longer reads attendance or leave (D-017) and has no statutory deductions (D-019). The time saved goes to reimbursements and passwordless authentication.

| Weeks | Phase | Content | Exit gate |
|---|---|---|---|
| 0 (before week 1) | Engineering foundation (roadmap Stage 7) | Monorepo scaffold, CI, local Postgres, Worker deploy of an empty app to staging, free accounts set up | Green CI on an empty app deployed to staging |
| 1-2 | 1. Foundation | Auth (passkey, email OTP, TOTP), roles and permissions, organization settings, departments, positions, employees CRUD, audit infrastructure, outbox and email | Employee management works; permission and IDOR tests pass |
| 3-4 | 2. Attendance and leave | Schedules, holidays, check-in/out, daily status, corrections, leave types, policies, ledger, approvals inbox, team calendar | Ledger concurrency, date-handling and balance tests pass |
| 5-6 | 3. Payroll and reimbursements | Salary structures, runs, proration, adjustments, transport claims, validation, approval, lock, payments, reconciliation, payslips | Every case in `docs/07-quality/PAYROLL-TEST-CASES.md` matches independently approved results |
| 7-8 | 4. Documents and self-service | Private documents, versions, expiry reminders, employee dashboard, profile change requests, mobile refinements | Self-service usable on a phone; private records isolated |
| 9 | 5a. Reports and settings | Reports and exports, settings history, health page | Exports enforce the same permissions as the API |
| 10-12 | 5b. Hardening and launch | CSV import of real employees, security and E2E tests, accessibility audit, backup restore drill, training, go-live | All SRS §11.2 acceptance criteria pass; owner signs off |

## 4. Acceptance criteria for v1

SRS §11.2 applies, with these changes:

- Criterion 11 (payroll compared with independent calculations) uses the v1 payroll rules: prorated gross, reimbursements and adjustments only.
- Criterion 12 (restore drill) restores a nightly `pg_dump` from R2 into a fresh Neon branch.
- Added: the app runs for one full month in staging within every free-tier limit in ADR-0009.
- Added: every privileged user has a passkey or TOTP registered before go-live.

## 5. Open questions (owner)

- Document retention periods per category (X-003).
- Leave allocation, carry-forward and expiry values per leave type.
- Default core-hours window and minimum daily hours.
- First-year holiday list.
- Named person who approves the payroll calculation rules and the independent test results.
- Whether existing employee data will be imported from a spreadsheet, and who prepares it.
