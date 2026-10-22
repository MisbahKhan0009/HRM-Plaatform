# Glossary

Terms used across the HRM documentation and code. Code identifiers are in `code` style and match `docs/03-architecture/DOMAIN-MODEL.md`. When a term here and a canonical document disagree, the canonical document wins and this file is the bug.

## Business terms

| Term | Meaning |
|---|---|
| Approval inbox | The in-app list of requests waiting for the current user's decision (`approvals` module). It is a work queue, not a notification centre (D-025). |
| Archived employee | An employee with status `archived`: hidden from default lists, with all history kept (FR-EMP-006). |
| BDT, taka (৳) | Bangladeshi taka, the default currency. Stored with 2 decimal places; the subunit is the poisha (1/100 taka). |
| Calendar-day proration | Pay for part of a month: gross × days employed in the period ÷ days in that month (D-022). |
| Carry-forward | Unused leave moved into the next leave year, within a policy limit, posted as a `carry_forward` ledger entry. |
| Casual leave | Short-notice leave type. Seed allocation follows the Bangladesh Labour Act; the company confirms the value. |
| Compensatory leave | Leave granted in exchange for working on a non-working day. HR grants it with an adjustment entry. |
| Core hours | The window of the day an employee is expected to be present under flexible hours (D-010). |
| Director | Top-management role that reads all compensation and payroll and may approve payroll (D-008). |
| Earned leave, annual leave | Leave earned by days worked; in the Bangladesh Labour Act, 1 day per 18 days worked. Seed value only. |
| Effective date | The date a change takes effect (salary, policy, manager, status). Records before it keep the old value. |
| Employee code | The human-readable employee identifier, `EMP-0001` format (X-001). Different from the database `id`. |
| Employment event | An effective-dated entry in an employee's history, such as `promoted` or `transferred`. |
| Gross salary | The single monthly salary amount in a salary structure (D-018). |
| Half day | Half a working day of leave: `first_half` or `second_half` (D-015). |
| Holiday | A non-working date in the holiday list; not counted as a leave day or an absence. |
| Leave ledger | The list of all leave entries (grant, accrual, reservation, usage, reversal and others) for an employee and leave type. The balance is the sum of the ledger (FR-LEAVE-008). |
| Leave year | The calendar year, January to December (D-015). |
| Line item | One earning or deduction row in a payroll item, with a `payroll_line_code`. |
| Lock (payroll) | The `locked` state of a payroll run: the snapshot is frozen and can only be corrected by an adjustment in a later run. |
| Manager | A user whose employee record has direct reports. The role is derived, not assigned. |
| Net pay | Earnings minus deductions for one employee in one run. |
| Payroll adjustment | An approved addition or deduction applied once in a future run (`PayrollAdjustment`). |
| Payroll period | One calendar month for which salary is calculated. |
| Payroll run | One calculation of a period, with its own lifecycle (`draft` to `reconciled`). |
| Payslip | The employee-facing statement of one payroll item, published at `locked` or later. |
| Reconciliation | Comparing net pay with recorded payments for a run and resolving differences (FR-PAY-015). |
| Reimbursement claim | An employee's request to be repaid an expense; v1 supports transport only (D-020). |
| Reservation | A ledger entry holding back balance for a pending leave request (D-016). |
| Self-approval | A preparer approving their own payroll run: allowed, flagged and justified (D-007). Not allowed for any other request. |
| Separation | The end of employment (resignation, termination, contract end); status `separated`. |
| TDS | Tax deducted at source on salary. Not handled in v1 (D-019, D-023). |
| Work date | The date an attendance record belongs to: the `Asia/Dhaka` date of the check-in (D-011). |
| Work schedule | Working days, core window and minimum daily hours assigned to employees from an effective date. |

## Technical terms

| Term | Meaning |
|---|---|
| ADR | Architecture Decision Record, in `docs/01-tech-stack/adr/`. |
| Audit log | Append-only record of who did what to which entity and when (`audit` module). |
| Cron Trigger | Cloudflare's scheduler. One trigger runs every minute and dispatches all jobs (ADR-0002). |
| DTO | Data Transfer Object: the shape an API returns for a given permission level, such as `EmployeeBasic` or `EmployeeFull`. |
| Email OTP | One-time code sent by email for sign-in (D-033). |
| Hyperdrive | Cloudflare service that pools database connections between Workers and Neon. |
| Idempotency key | A client-chosen key sent in the `Idempotency-Key` header so that a retried command runs once. |
| IDOR | Insecure Direct Object Reference: reading another user's record by changing an id. Prevented by scope checks and 404 responses. |
| Ink, Paper | The brand's dark and light themes. Ink is the default (D-040). |
| Modular monolith | One deployable application split into modules with enforced boundaries. |
| Neon | Hosted serverless Postgres used on its free plan. |
| Outbox | A database table of messages written in the same transaction as a business change and sent later by a job (D-036). |
| Passkey | A WebAuthn credential (fingerprint, face, device PIN) used to sign in without a password. |
| R2 | Cloudflare object storage; private bucket for documents and backups. |
| Recovery code | A single-use code that replaces a lost TOTP device. |
| Scope | The set of records a permission covers: `own`, `team` or `all` (SECURITY-MODEL §3). |
| Snapshot | The immutable copy of inputs and outputs stored on each payroll item at calculation. |
| Strong session | A session signed in with a passkey, or an email OTP plus TOTP. Required for privileged roles. |
| TOTP | Time-based one-time password from an authenticator app. |
| Workers Free | The free Cloudflare Workers plan: 100,000 requests a day and 10 ms CPU per request. |
| `workers.dev` | The free Cloudflare subdomain the app is served on (D-035). |
