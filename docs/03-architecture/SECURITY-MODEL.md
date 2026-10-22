# Security and authorization model (canonical)

Status: **Accepted** — 2026-10-22. Source for roles, permission codenames and record scopes. Implements SRS §6 as modified by D-006, D-008, D-014, D-033.

## 1. Principles

1. Every request is authenticated and authorized **on the server** (NFR-SEC-004). The UI only hides what the API would refuse.
2. **Deny by default.** A permission not granted is denied.
3. Authorization = **permission** (may this user do this kind of action?) + **scope** (on which records?). Both are checked; route-level checks alone are insufficient (SRS §6.2).
4. Technical administration grants no business data access.
5. Self-service actions derive the employee from the session, never from a client-supplied ID (FR-ATT-012).
6. Unauthorized access to a record that exists returns **404**, not 403, so IDs can't be probed (IDOR protection).
7. Every change to roles, permissions or sensitive settings is audited (FR-AUD-002).

## 2. Roles (default)

| Role code | Who | MFA required | Assigned how |
|---|---|---|---|
| `system_admin` | Technical administrator | yes | explicit |
| `hr_admin` | HR staff | yes | explicit |
| `payroll_officer` | Payroll / finance | yes | explicit |
| `director` | Top management (D-008) | yes | explicit |
| `auditor` | Read-only reviewer | yes | explicit |
| `manager` | Anyone with direct reports | no | **derived** automatically from the reporting line; cannot be assigned by hand |
| `employee` | Anyone with a linked employee record | no | **derived** from the user ↔ employee link |

A user's effective permissions are the union of all roles (SRS §6.2). "MFA required" means the session must be **strong**: signed in with a passkey, or email OTP + TOTP (D-033). A privileged role on a weak session is suspended for that request (`403 MFA_REQUIRED`), and the UI prompts for step-up.

## 3. Scopes

| Scope | Meaning |
|---|---|
| `own` | The employee linked to the current user |
| `team` | The user's direct **and indirect** reports (recursive reporting tree), excluding themselves |
| `all` | Every employee in the company |

Scope is part of the permission codename: `<resource>.<action>.<scope>`.

## 4. Permission catalogue

| Permission | system_admin | hr_admin | payroll_officer | director | auditor | manager | employee |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `user.manage` (invite, suspend, deactivate) | ✓ | ✓ | | | | | |
| `role.manage` (assign roles) | ✓ | | | | | | |
| `settings.technical.manage` | ✓ | | | | | | |
| `settings.hr.manage` (schedules, holidays, leave defaults) | | ✓ | | | | | |
| `settings.payroll.manage` | | | ✓ | | | | |
| `settings.read` | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| `org.manage` (departments, positions) | | ✓ | | | | | |
| `employee.read.all` | | ✓ | ✓ | ✓ | ✓ | | |
| `employee.read.team` | | | | | | ✓ | |
| `employee.read.own` | | | | | | | ✓ |
| `employee.manage` (create, edit, lifecycle, archive) | | ✓ | | | | | |
| `employee.contact.read.all` (restricted contact data) | | ✓ | | | | | |
| `profile_change.request.own` | | | | | | | ✓ |
| `profile_change.review.all` | | ✓ | | | | | |
| `compensation.read.all` (salary structures) | | ✓ | ✓ | ✓ | ✓ | | |
| `compensation.read.own` | | | | | | | ✓ |
| `compensation.manage` | | | ✓ | | | | |
| `payroll.read.all` | | | ✓ | ✓ | ✓ | | |
| `payroll.prepare` (create, calculate, submit, adjust) | | | ✓ | | | | |
| `payroll.approve` | | | ✓ | ✓ | | | |
| `payroll.lock` / `payroll.pay` (record payments, publish payslips) | | | ✓ | | | | |
| `payslip.read.all` | | | ✓ | ✓ | ✓ | | |
| `payslip.read.own` | | | | | | | ✓ |
| `attendance.check_in.own` | | | | | | | ✓ |
| `attendance.read.all` | | ✓ | ✓ | ✓ | ✓ | | |
| `attendance.read.team` | | | | | | ✓ | |
| `attendance.read.own` | | | | | | | ✓ |
| `attendance.manage` (manual entries, schedules) | | ✓ | | | | | |
| `attendance.correction.request.own` | | | | | | | ✓ |
| `attendance.correction.review.team` | | | | | | ✓ | |
| `attendance.correction.review.all` | | ✓ | | | | | |
| `leave.policy.manage` | | ✓ | | | | | |
| `leave.read.all` | | ✓ | | ✓ | ✓ | | |
| `leave.read.team` | | | | | | ✓ | |
| `leave.request.own` | | | | | | | ✓ |
| `leave.request.review.team` | | | | | | ✓ | |
| `leave.request.review.all` (when no manager; act on behalf, audited) | | ✓ | | | | | |
| `leave.balance.adjust` | | ✓ | | | | | |
| `reimbursement.request.own` | | | | | | | ✓ |
| `reimbursement.review.team` | | | | | | ✓ | |
| `reimbursement.review.all` | | ✓ | ✓ | | | | |
| `reimbursement.read.all` | | ✓ | ✓ | ✓ | ✓ | | |
| `document.read.own` (non-restricted own documents) | | | | | | | ✓ |
| `document.read.all` / `document.manage` | | ✓ | | | | | |
| `document.payroll.read` (payroll category) | | | ✓ | ✓ | ✓ | | |
| `approval.inbox` | | ✓ | ✓ | ✓ | | ✓ | |
| `report.hr` | | ✓ | | ✓ | ✓ | | |
| `report.payroll` | | | ✓ | ✓ | ✓ | | |
| `report.team` | | | | | | ✓ | |
| `audit.read.all` | | ✓ | | ✓ | ✓ | | |
| `audit.read.payroll` | | | ✓ | | | | |
| `audit.read.technical` | ✓ | | | | | | |
| `system.health.read` | ✓ | | | | | | |

`hr_admin` reads salary (D-008) but cannot change it. `system_admin` has no business data permissions by default (SRS §6.1). The matrix is seed data; roles and grants can be changed by `role.manage`, and every change is audited.

## 5. Field-level rules

- `EmployeeContact` (personal phone, address, emergency contacts, national ID number) needs `employee.contact.read.all`, or `own`.
- Salary fields are never included in employee payloads; they're served by `/salary-structures` endpoints under `compensation.*`.
- API responses are built from per-permission DTOs (`EmployeeBasic`, `EmployeeFull`, `EmployeeSelf`), never by serializing the database row.
- Exports use the same DTOs and checks as the API (FR-REP-006).

## 6. Approval rules (D-014)

| Subject | Approver | Fallback |
|---|---|---|
| Leave, attendance correction, reimbursement claim | Direct manager | `hr_admin` if no manager, or the manager is the requester |
| Profile change | `hr_admin` | — |
| Payroll run | `payroll.approve` holder | Preparer may self-approve with flag + justification (D-007) |
| Payroll adjustment | `payroll.approve` holder | same as run |

Requesters never approve their own requests (FR-WF-004), except payroll as above. Decisions are immutable; reversal is a new event (FR-WF-005).

## 7. Authentication summary (ADR-0004)

Passwordless: passkeys or email OTP; TOTP for strong sessions. Invite-only. Session cookie `HttpOnly; Secure; SameSite=Lax`; idle timeout 8 h, absolute 7 days; privileged roles: idle 1 h. Rate limits on OTP send/verify (per email and per IP). Sensitive actions (role change, payroll lock, payment recording) require a session authenticated within the last 15 min (re-auth).

## 8. Data protection

- Production data never copied to staging/dev without anonymisation (`scripts/anonymise`, NFR-SEC-009).
- Audit metadata never contains OTPs, tokens, full national IDs or full salary snapshots, only changed field names and references (FR-AUD-004). Salary change audits record old/new amount, as the SRS requires them, but are readable only with `audit.read.payroll`/`audit.read.all`.
- R2 objects are private; downloads go through `/documents/{id}/download` with a permission check and an access audit for restricted categories (FR-DOC-007).
- Retention per document category is configurable (X-003); deletion runs as an audited job.
