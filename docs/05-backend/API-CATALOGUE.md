# API catalogue (v1)

Status: **Accepted**, 2026-10-22. Reference. Lists every v1 endpoint with its permission, scope and transition. It replaces SRS §8, applying decisions D-014, D-020, D-025, D-033, D-037 and D-040. Wire rules (pagination, errors, money, idempotency) are in `API-STANDARDS.md`; permission codenames in `docs/03-architecture/SECURITY-MODEL.md`. The generated `apps/api/openapi.json` is the authority for field-level schemas; this catalogue is the authority for which endpoints exist.

Legend: **Idem.** `key` = `Idempotency-Key` header required. **Strong** = session must be strong (passkey or TOTP). **Fresh** = strong auth within the last 15 minutes. All paths are relative to `/api/v1`. "List" responses are paginated `{ data, page }`.

## 1. Authentication (`accounts`)

Better Auth serves its routes under `/api/v1/auth/*` (`basePath`). The exact Better Auth paths come from the version pinned in `packages/auth`; after an upgrade, regenerate this table from `auth.api` and update the web client. Our own endpoints are marked **custom**.

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/auth/email-otp/send-verification-otp` | public | Send a sign-in code (`type: "sign-in"`). Always returns `200`, even for unknown emails (no account enumeration) |
| POST | `/auth/sign-in/email-otp` | public | Verify code, create session (weak) |
| GET | `/auth/passkey/generate-authenticate-options` | public | WebAuthn challenge |
| POST | `/auth/passkey/verify-authentication` | public | Verify assertion, create session (strong) |
| GET | `/auth/passkey/generate-register-options` | session | Start adding a passkey |
| POST | `/auth/passkey/verify-registration` | session | Save passkey |
| GET | `/auth/passkey/list-user-passkeys` | session | Own passkeys |
| POST | `/auth/passkey/delete-passkey` | session, Fresh | Remove a passkey |
| POST | `/auth/two-factor/enable` | session, Fresh | Start TOTP enrolment (returns TOTP URI + backup codes) |
| POST | `/auth/two-factor/verify-totp` | session | Confirm enrolment |
| POST | `/auth/two-factor/disable` | session, Fresh | Not allowed while the user holds a role with `requires_strong_auth` |
| POST | `/auth/two-factor/generate-backup-codes` | session, Fresh | Replace recovery codes |
| POST | `/auth/step-up/totp` | session | **custom.** Verify TOTP or backup code on the current session, set `strong_auth_at` |
| POST | `/auth/step-up/passkey` | session | **custom.** Verify passkey assertion on the current session, set `strong_auth_at` |
| GET | `/auth/me` | session | **custom.** Identity, employee link, roles, permissions, `strongAuth`, theme, locale (FR-AUTH-004). Response `CurrentUser` |
| PATCH | `/auth/me/preferences` | session | **custom.** `{ theme: "ink" \| "paper", locale }` (D-040). Response `CurrentUser` |
| GET | `/auth/list-sessions` | session | Own sessions |
| POST | `/auth/revoke-session` | session | Revoke one own session |
| POST | `/auth/sign-out` | session | End current session (FR-AUTH-003) |
| GET | `/auth/invitations/{token}` | public | **custom.** Validate invitation, return masked email + company name |
| POST | `/auth/invitations/{token}/accept` | public | **custom.** Accept: activates user, sends sign-in code |

Account recovery for users who lost their passkey and authenticator is an HR/admin action (`POST /users/{id}/reset-auth`), not a public endpoint (`AUTH-IMPLEMENTATION.md` section 6).

## 2. Users and roles (`accounts`)

| Method | Path | Permission | Notes | DTOs |
|---|---|---|---|---|
| GET | `/users` | `user.manage` | List; filter `status`, `q` | `UserSummary` |
| POST | `/users/invitations` | `user.manage`, Strong | Create user in `invited`, link optional `employeeId`, email invite | `InviteUserInput` → `UserDetail` |
| POST | `/users/{id}/invitations/resend` | `user.manage` | New token, old one revoked | `UserDetail` |
| GET | `/users/{id}` | `user.manage` | | `UserDetail` |
| POST | `/users/{id}/suspend` | `user.manage`, Fresh | `active` → `suspended`, revokes sessions | `UserDetail` |
| POST | `/users/{id}/reactivate` | `user.manage`, Fresh | `suspended` → `active` | `UserDetail` |
| POST | `/users/{id}/deactivate` | `user.manage`, Fresh | → `deactivated` | `UserDetail` |
| POST | `/users/{id}/reset-auth` | `user.manage`, Fresh | Removes passkeys + TOTP, revokes sessions, emails a sign-in link; audited | `UserDetail` |
| POST | `/users/{id}/roles` | `role.manage`, Fresh | Replace explicit roles `{ roleCodes: [] }`; derived roles rejected | `UserDetail` |
| GET | `/roles` | `role.manage` or `settings.read` | Roles with permissions | `Role` |
| PATCH | `/roles/{id}` | `role.manage`, Fresh | Change name/description/permissions | `UpdateRoleInput` → `Role` |
| GET | `/permissions` | `role.manage` | Permission catalogue | `Permission` |

Users cannot change their own roles or suspend themselves (`SELF_APPROVAL_NOT_ALLOWED`).

## 3. Organization and settings

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/settings` | `settings.read` | All settings the caller may read, grouped by scope |
| PATCH | `/settings` | `settings.<scope>.manage` per key, Strong | `{ changes: { key: value }, version }`; each key checked against its scope; writes `settings_history` |
| GET | `/company` | any session | Name, logo URL, timezone, currency |
| PATCH | `/company` | `settings.hr.manage` | FR-ORG-001 |
| GET / POST | `/departments` | read: any session; write: `org.manage` | |
| PATCH | `/departments/{id}` | `org.manage` | `isActive=false` to retire |
| GET / POST | `/positions` | read: any session; write: `org.manage` | |
| PATCH | `/positions/{id}` | `org.manage` | |
| GET / POST | `/work-schedules` | read: `attendance.read.*`; write: `attendance.manage` | |
| PATCH | `/work-schedules/{id}` | `attendance.manage` | Changing core window does not rewrite closed days |
| POST | `/schedule-assignments` | `attendance.manage` | `{ employeeId, workScheduleId, effectiveFrom, effectiveTo? }`; closes the previous open assignment |
| GET | `/holidays` | any session | `?year=` |
| POST | `/holidays` | `settings.hr.manage` | |
| PATCH / DELETE | `/holidays/{id}` | `settings.hr.manage` | Delete only for future dates |

## 4. Employees

| Method | Path | Permission + scope | Idem. | Notes / transition | DTOs |
|---|---|---|---|---|---|
| GET | `/employees` | `employee.read.all` / `.team` | | List; filters `status`, `departmentId`, `positionId`, `managerId`, `q`; sort `employeeCode`, `lastName`, `joiningDate` | `EmployeeBasic` |
| POST | `/employees` | `employee.manage` | | Creates `draft`; code generated (X-001) | `CreateEmployeeInput` → `EmployeeFull` |
| GET | `/employees/{id}` | `employee.read.all` / `.team` / `.own` | | DTO depends on permission | `EmployeeFull` / `EmployeeBasic` / `EmployeeSelf` |
| PATCH | `/employees/{id}` | `employee.manage` | | Non-lifecycle fields only; manager change runs cycle check | `UpdateEmployeeInput` |
| GET | `/employees/{id}/contact` | `employee.contact.read.all` or own | | | `EmployeeContact` |
| PATCH | `/employees/{id}/contact` | `employee.manage` | | | `UpdateEmployeeContactInput` |
| GET | `/employees/{id}/history` | `employee.read.all` / own | | Employment events | `EmploymentEvent` |
| POST | `/employees/{id}/employment-events` | `employee.manage` | | Promotion, transfer, manager change; future date = `scheduled` | `CreateEmploymentEventInput` |
| POST | `/employees/{id}/start-preboarding` | `employee.manage` | | `draft` → `preboarding` | `EmployeeFull` |
| POST | `/employees/{id}/hire` | `employee.manage` | | → `probation` or `active` on `effectiveDate` | |
| POST | `/employees/{id}/confirm` | `employee.manage` | | `probation` → `active` | |
| POST | `/employees/{id}/start-notice` | `employee.manage` | | → `notice_period` | |
| POST | `/employees/{id}/separate` | `employee.manage`, Fresh | | → `separated`; schedules access revocation | `SeparateEmployeeInput` |
| POST | `/employees/{id}/rehire` | `employee.manage` | | `separated` → `active` | |
| POST | `/employees/{id}/archive` | `employee.manage` | | `separated` → `archived` | |
| GET / POST | `/employees/{id}/contracts` | read: `employee.read.all` / own; write: `employee.manage` | | FR-DOC-009 | `EmploymentContract` |
| PATCH | `/employees/{id}/contracts/{contractId}` | `employee.manage` | | | |
| POST | `/employees/import/preview` | `employee.manage` | | CSV upload; returns mapping, row errors, duplicates (FR-EMP-008); nothing saved | `EmployeeImportPreview` |
| POST | `/employees/import/commit` | `employee.manage` | key | Commits a preview by `previewToken` | `EmployeeImportResult` |
| GET | `/me/profile` | `employee.read.own` | | Shortcut to own `EmployeeSelf` | |
| GET / POST | `/profile-change-requests` | list: `profile_change.review.all` or own; create: `profile_change.request.own` | | Create derives employee from session | `ProfileChangeRequest` |
| POST | `/profile-change-requests/{id}/approve` | `profile_change.review.all` | | applies changes | |
| POST | `/profile-change-requests/{id}/reject` | `profile_change.review.all` | | comment required | |
| POST | `/profile-change-requests/{id}/withdraw` | own | | | |

## 5. Attendance

| Method | Path | Permission + scope | Notes / transition |
|---|---|---|---|
| POST | `/attendance/check-in` | `attendance.check_in.own` | Body `{}`; employee from session (FR-ATT-012); `409 ALREADY_CHECKED_IN` |
| POST | `/attendance/check-out` | `attendance.check_in.own` | `409 NOT_CHECKED_IN` |
| GET | `/attendance/me` | `attendance.read.own` | `?from&to` (max 366 days); records + today's state |
| GET | `/attendance` | `attendance.read.all` / `.team` | Records list; `from`, `to` required; filters `employeeId`, `departmentId`, `status` |
| GET | `/attendance/{employeeId}/{workDate}` | read scopes | Record + all events (evidence) |
| GET | `/attendance/summary` | read scopes | Per-employee counts per status for `from`..`to` (FR-ATT-011) |
| POST | `/attendance/manual-entries` | `attendance.manage` | `{ employeeId, workDate, checkInAt, checkOutAt, reason }` (FR-ATT-009) |
| GET | `/attendance/corrections` | `attendance.correction.review.*` or own | filters `status`, `employeeId` |
| POST | `/attendance/corrections` | `attendance.correction.request.own` | Creates `pending` + approval request |
| POST | `/attendance/corrections/{id}/approve` | `attendance.correction.review.team` / `.all` | `pending` → `approved`; appends `correction` event |
| POST | `/attendance/corrections/{id}/reject` | same | comment required |
| POST | `/attendance/corrections/{id}/withdraw` | own | |

## 6. Leave

| Method | Path | Permission + scope | Idem. | Notes / transition |
|---|---|---|---|---|
| GET | `/leave/types` | any session | | Active types with current policy summary |
| POST | `/leave/types` | `leave.policy.manage` | | |
| PATCH | `/leave/types/{id}` | `leave.policy.manage` | | |
| GET / POST | `/leave/types/{id}/policies` | `leave.policy.manage` | | New policy version, `effectiveFrom` today or later |
| GET | `/leave/balances/me` | `leave.request.own` | | `?year=`; per type: entitled, used, reserved, available |
| GET | `/leave/balances` | `leave.read.all` / `.team` | | `?year&employeeId&departmentId` |
| GET | `/leave/balances/{employeeId}/ledger` | `leave.read.all` / `.team` / own | | `?year&leaveTypeId` |
| POST | `/leave/balances/adjustments` | `leave.balance.adjust`, Strong | key | `{ employeeId, leaveTypeId, year, amount, reason }` |
| POST | `/leave/requests/preview` | `leave.request.own` | | Computes working days and balance effect without saving |
| GET | `/leave/requests` | `leave.read.all` / `.team` or own | | filters `status`, `employeeId`, `leaveTypeId`, `from`, `to` |
| POST | `/leave/requests` | `leave.request.own` (or `leave.request.review.all` with `employeeId` = on behalf) | | Creates `draft` |
| GET | `/leave/requests/{id}` | read scopes or own | | |
| PATCH | `/leave/requests/{id}` | own, `draft` only | | |
| DELETE | `/leave/requests/{id}` | own, `draft` only | | |
| POST | `/leave/requests/{id}/submit` | own | | `draft` → `pending`; posts reservation |
| POST | `/leave/requests/{id}/withdraw` | own | | `pending` → `withdrawn`; releases reservation |
| POST | `/leave/requests/{id}/approve` | `leave.request.review.team` / `.all` | key | `pending` → `approved`; release + usage (atomic) |
| POST | `/leave/requests/{id}/reject` | same | | `pending` → `rejected`; comment required |
| POST | `/leave/requests/{id}/cancel` | own (or HR on behalf) | | `approved` → `cancellation_pending`; future or current leave only |
| POST | `/leave/requests/{id}/cancel/approve` | review scopes | key | → `cancelled`; posts reversal |
| POST | `/leave/requests/{id}/cancel/reject` | review scopes | | → `approved` |
| GET | `/leave/calendar` | `leave.read.all` / `.team`; own team for employees (setting `leave.calendar.visible_to_team`) | | `from`, `to` (max 92 days); shows type only to readers with `leave.read.*` (FR-LEAVE-011) |

## 7. Reimbursements

| Method | Path | Permission + scope | Notes / transition |
|---|---|---|---|
| GET | `/reimbursement-claims` | `reimbursement.read.all`, `.review.team` or own | filters `status`, `employeeId`, `from`, `to` |
| POST | `/reimbursement-claims` | `reimbursement.request.own` | `draft`; optional receipt `documentId` |
| PATCH / DELETE | `/reimbursement-claims/{id}` | own, `draft` only | |
| POST | `/reimbursement-claims/{id}/submit` | own | `draft` → `submitted` |
| POST | `/reimbursement-claims/{id}/withdraw` | own | `submitted` → `withdrawn` |
| POST | `/reimbursement-claims/{id}/approve` | `reimbursement.review.team` / `.all` | `submitted` → `approved` |
| POST | `/reimbursement-claims/{id}/reject` | same | comment required |

`included` and `paid` are set by payroll, never by an endpoint.

## 8. Payroll

| Method | Path | Permission | Idem. | Notes / transition |
|---|---|---|---|---|
| GET | `/salary-structures` | `compensation.read.all` or own | | `?employeeId` |
| POST | `/salary-structures` | `compensation.manage`, Strong | | `draft`; `{ employeeId, grossAmount, effectiveFrom, reason }` |
| POST | `/salary-structures/{id}/approve` | `compensation.manage`, Fresh | | `draft` → `approved`; closes previous structure's `effectiveTo`; emits `salary_changed` event |
| GET | `/payroll/periods` | `payroll.read.all` | | |
| POST | `/payroll/periods` | `payroll.prepare` | | `{ year, month }`; dates computed |
| GET | `/payroll/runs` | `payroll.read.all` | | filters `periodId`, `status` |
| POST | `/payroll/runs` | `payroll.prepare`, Strong | key | `{ periodId, runType }` → `draft`; `409 PAYROLL_RUN_EXISTS` |
| GET | `/payroll/runs/{id}` | `payroll.read.all` | | Run + totals + validation summary |
| GET | `/payroll/runs/{id}/items` | `payroll.read.all` | | List; `?employeeId&flag` |
| GET | `/payroll/runs/{id}/items/{itemId}` | `payroll.read.all` | | Item + line items + snapshot |
| POST | `/payroll/runs/{id}/calculate` | `payroll.prepare`, Strong | key | `draft`/`calculated` → `calculated`; replaces items |
| POST | `/payroll/runs/{id}/validate` | `payroll.prepare` | | Re-runs validation, returns flags; no state change |
| POST | `/payroll/runs/{id}/submit` | `payroll.prepare`, Strong | key | `calculated` → `submitted`; blocked by blocking flags |
| POST | `/payroll/runs/{id}/return` | `payroll.approve`, Strong | | `submitted` → `returned` → `draft`; reason required |
| POST | `/payroll/runs/{id}/approve` | `payroll.approve`, Fresh | key | `submitted` → `approved`; self-approval needs `selfApprovalNote` (D-007) |
| POST | `/payroll/runs/{id}/lock` | `payroll.lock`, Fresh | key | `approved` → `locked`; marks claims/adjustments |
| POST | `/payroll/runs/{id}/payments` | `payroll.pay`, Fresh | key | Record one payment `{ payrollItemId, method, amount, paidOn, chequeNumber?, acknowledgedByName? }` |
| POST | `/payroll/runs/{id}/payments/import` | `payroll.pay`, Fresh | key | CSV of payments; preview with `?dryRun=true` |
| POST | `/payroll/payments/{paymentId}/cancel` | `payroll.pay`, Fresh | | reason required |
| POST | `/payroll/runs/{id}/mark-paid` | `payroll.pay`, Fresh | | `locked` → `paid` when every item is paid |
| POST | `/payroll/runs/{id}/reconcile` | `payroll.pay`, Fresh | | `paid` → `reconciled` |
| GET | `/payroll/runs/{id}/reconciliation` | `payroll.read.all` | | Gross, deductions, net vs payments per item (FR-PAY-015) |
| POST | `/payroll/runs/{id}/publish-payslips` | `payroll.pay`, Fresh | key | Creates `payslips`; queues emails |
| GET / POST | `/payroll/adjustments` | read `payroll.read.all`; create `payroll.prepare` | key on POST | |
| POST | `/payroll/adjustments/{id}/approve` | `payroll.approve`, Fresh | | |
| POST | `/payroll/adjustments/{id}/reject` | `payroll.approve` | | |
| GET | `/payroll/payslips/me` | `payslip.read.own` | | Own published payslips |
| GET | `/payroll/payslips` | `payslip.read.all` | | |
| GET | `/payroll/payslips/{id}` | `payslip.read.all` or own | | Immutable `PayslipData` for browser PDF rendering (D-037); sets `firstViewedAt`; audited |

The SRS endpoint `GET /payroll/payslips/{id}/download` is replaced by `GET /payroll/payslips/{id}`, because the browser builds the PDF.

## 9. Documents

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/employees/{id}/documents` | `document.read.all`, own (non-restricted), `document.payroll.read` (payroll category) | |
| POST | `/employees/{id}/documents` | `document.manage`; employees may upload `receipt` documents for themselves with `reimbursement.request.own` | multipart; `{ category, title, issueDate?, expiryDate?, isRestricted? }` |
| POST | `/documents/{id}/versions` | `document.manage` | New version; previous kept |
| GET | `/documents/{id}` | read rules | Metadata + versions |
| GET | `/documents/{id}/download` | read rules | Streams current version (`?version=`); restricted categories audited (FR-DOC-007) |
| POST | `/documents/{id}/delete` | `document.manage`, Fresh | Retention deletion; reason required |
| GET | `/company/documents` | any session (policy category) | Company-wide documents |

## 10. Approvals

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/approvals/inbox` | `approval.inbox` | Pending steps assigned to the user directly or through a permission; filter `subjectType` |
| GET | `/approvals/{id}` | approver, requester or `audit.read.all` | Request + steps; requester sees decision and comment but not other approvers' identities if setting `approvals.hide_reviewer` is true (FR-ESS-007) |
| GET | `/approvals/mine` | any employee | Own requests across subject types |

Decisions are made through the subject's action endpoint (`/leave/requests/{id}/approve`), which updates the approval step in the same transaction. Delegation (`POST /approvals/{id}/delegate`, SRS optional) is not in v1.

## 11. Notifications

Email only (D-025). No in-app notification endpoints in v1; `GET /notifications` and `POST /notifications/{id}/read` from SRS §8.6 are deferred.

## 12. Reports and exports

All reports enforce the same scopes as their source lists (FR-REP-006). Responses are paginated JSON; the browser builds CSV/XLSX (D-037). `?format=` is not supported. Each export action logs `report.exported` to the audit log (the UI calls `POST /reports/exports` with the report name and filters before generating the file).

| Method | Path | Permission | Filters |
|---|---|---|---|
| GET | `/reports/headcount` | `report.hr` | `asOf`, `departmentId`, grouping |
| GET | `/reports/directory` | `report.hr`, `report.team` | `departmentId`, `status` |
| GET | `/reports/attendance` | `report.hr`, `report.team` | `from`, `to`, `departmentId`, `employeeId` |
| GET | `/reports/leave` | `report.hr`, `report.team` | `year`, `from`, `to`, `leaveTypeId`, `departmentId` |
| GET | `/reports/payroll-register` | `report.payroll` | `runId` |
| GET | `/reports/payroll-deductions` | `report.payroll` | `runId` or `year` |
| GET | `/reports/payment-reconciliation` | `report.payroll` | `runId` |
| GET | `/reports/reimbursements` | `report.payroll`, `report.hr` | `from`, `to`, `status` |
| POST | `/reports/exports` | the report's permission | `{ report, filters, rowCount }`; audit only |

## 13. Audit and health

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/audit-logs` | `audit.read.all`, `audit.read.payroll` (category payroll), `audit.read.technical` (category technical, security) | `from`, `to` required; `actorUserId`, `action`, `entityType`, `entityId`, `employeeId` (FR-AUD-005) |
| GET | `/health` | public | `{ status: "ok" }` only; no dependency details |
| GET | `/health/details` | `system.health.read` | DB latency, last `job_runs`, outbox backlog, dead messages (FR-SET-004) |
| GET | `/openapi.json` | public in staging/local; disabled in production | |
