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
| POST | `/auth/passkey/verify-authentication` (step-up) | session | Passkey sign-in on top of a weak session replaces it with a strong one (D-045) |
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
| POST | `/users/invitations` | `user.manage`, Strong; also `role.manage` when `roleCodes` is not empty | Create user in `invited`, link optional `employeeId`, explicit `roleCodes`, email invite (7-day link); `409 EMAIL_TAKEN` (case-insensitive), `409 EMPLOYEE_ALREADY_LINKED` | `InviteUserInput` → `UserDetail` |
| POST | `/users/{id}/invitations/resend` | `user.manage` | New token, old one revoked; `invited` users only | `UserDetail` |
| GET | `/users/{id}` | `user.manage` | | `UserDetail` |
| POST | `/users/{id}/suspend` | `user.manage`, Fresh | `active` → `suspended`, revokes sessions; body `{ version, reason? }` | `UserActionInput` → `UserDetail` |
| POST | `/users/{id}/reactivate` | `user.manage`, Fresh | `suspended` → `active`; body `{ version, reason? }` | `UserActionInput` → `UserDetail` |
| POST | `/users/{id}/deactivate` | `user.manage`, Fresh | `invited`, `active` or `suspended` → `deactivated`, revokes sessions and open invitations; body `{ version, reason? }` | `UserActionInput` → `UserDetail` |
| POST | `/users/{id}/reset-auth` | `user.manage`, Fresh | Removes passkeys + TOTP, revokes sessions, emails a sign-in link; audited; `active` or `suspended` users only (`422` otherwise); body `{ version, reason? }` | `UserActionInput` → `UserDetail` |
| POST | `/users/{id}/roles` | `role.manage`, Fresh | Replace explicit roles `{ roleCodes: [], version }` (user version); derived roles rejected (`400`) | `ReplaceUserRolesInput` → `UserDetail` |
| GET | `/roles` | `role.manage` or `settings.read` | Roles with permissions | `Role` |
| PATCH | `/roles/{id}` | `role.manage`, Fresh | Change name/description/permissions (full set) with `version`; derived roles are editable but never assignable; removing `role.manage` from a role the caller holds is refused (`422`) | `UpdateRoleInput` → `Role` |
| GET | `/permissions` | `role.manage` | Permission catalogue | `Permission` |

Users cannot change their own roles, suspend, reactivate, deactivate or reset their own account (`SELF_APPROVAL_FORBIDDEN`). Other companies' users and roles return `404`. Role changes are audited as `role.granted` and `role.revoked` (per role), `role.permissions_changed` and `role.updated`.

## 3. Organization and settings

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/settings` | `settings.read`, or `settings.<scope>.manage` for that scope | All settings the caller may read, grouped by scope `{ technical?, hr?, payroll? }`; each item has `value`, `defaultValue`, per-key `version` (0 = never stored) and `editable` |
| PATCH | `/settings` | `settings.<scope>.manage` per key, Strong | `{ changes: { key: { value, version } } }` (1 to 30 keys, per-key optimistic version, all or none); each key validated by its catalogue schema (`400` at `/changes/<key>/value`) and checked against its scope (`403`); writes `settings_history` and audits `settings.changed` (category: technical, business for `hr`, payroll) |
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
| GET | `/employees/{id}` | `employee.read.all` / `.team` / `.own` | | DTO depends on permission; the `view` field (`full`, `basic`, `self`) names it | `EmployeeFull` / `EmployeeBasic` / `EmployeeSelf` |
| PATCH | `/employees/{id}` | `employee.manage` | | Non-lifecycle fields only; manager change runs cycle check | `UpdateEmployeeInput` |
| GET | `/employees/{id}/contact` | `employee.contact.read.all` or own | | | `EmployeeContact` |
| PATCH | `/employees/{id}/contact` | `employee.manage` | | `version: 0` creates the record when none exists | `UpdateEmployeeContactInput` |
| GET | `/employees/{id}/history` | `employee.read.all` / `.team` / own | | Employment events; `.team` readers do not see `salary_changed` (US-EMP-005) | `EmploymentEvent` |
| POST | `/employees/{id}/employment-events` | `employee.manage` | | Promotion, transfer, manager change; future date = `scheduled` | `CreateEmploymentEventInput` |
| POST | `/employees/{id}/start-preboarding` | `employee.manage` | | `draft` → `preboarding` | `EmployeeFull` |
| POST | `/employees/{id}/hire` | `employee.manage` | | `preboarding` → `probation` (with `probationEndDate`) or `active` on `effectiveDate` | `HireEmployeeInput` |
| POST | `/employees/{id}/confirm` | `employee.manage` | | `probation` → `active` | |
| POST | `/employees/{id}/start-notice` | `employee.manage` | | → `notice_period` | |
| POST | `/employees/{id}/separate` | `employee.manage`, Fresh | | → `separated` on `separationDate` (last employed day); the daily job `accounts.apply_access_revocation` deactivates the login after it | `SeparateEmployeeInput` |
| POST | `/employees/{id}/rehire` | `employee.manage` | | `separated` → `active` | |
| POST | `/employees/{id}/archive` | `employee.manage` | | `separated` → `archived` | |
| GET / POST | `/employees/{id}/contracts` | read: `employee.read.all` / own; write: `employee.manage` | | FR-DOC-009 | `EmploymentContract` |
| PATCH | `/employees/{id}/contracts/{contractId}` | `employee.manage` | | | |
| POST | `/employees/import/preview` | `employee.manage` | | JSON `{ csv, mapping? }`, at most 500 rows; returns mapping, row errors, duplicates and `previewToken` (SHA-256 of the CSV) (FR-EMP-008); nothing saved | `EmployeeImportPreviewInput` → `EmployeeImportPreview` |
| POST | `/employees/import/commit` | `employee.manage` | key | Re-sends `{ csv, previewToken, mapping? }`; the server re-validates and creates the valid rows in `draft`; nothing is stored between preview and commit | `EmployeeImportCommitInput` → `EmployeeImportResult` |
| GET | `/me/profile` | `employee.read.own` | | Shortcut to own `EmployeeSelf` | |
| GET / POST | `/profile-change-requests` | list: `profile_change.review.all` or own; create: `profile_change.request.own` | | Create derives employee from session | `ProfileChangeRequest` |
| GET | `/profile-change-requests/{id}` | `profile_change.review.all` or own | | Same scopes as the list; another employee's request returns 404 | `ProfileChangeRequest` |
| POST | `/profile-change-requests/{id}/approve` | `profile_change.review.all` | | applies changes | |
| POST | `/profile-change-requests/{id}/reject` | `profile_change.review.all` | | comment required | |
| POST | `/profile-change-requests/{id}/withdraw` | own | | | |

## 5. Attendance

| Method | Path | Permission + scope | Notes / transition |
|---|---|---|---|
| POST | `/attendance/check-in` | `attendance.check_in.own` | Body `{}`, other keys ignored; employee from session (FR-ATT-012); `201 { event, record }`; `409 ALREADY_CHECKED_IN`; 10 per minute |
| POST | `/attendance/check-out` | `attendance.check_in.own` | `201 { event, record }`; `409 NOT_CHECKED_IN` |
| GET | `/attendance/me` | `attendance.read.own` | `?from&to` (max 366 days; default current month to today), `sort`; paginated records + `today` (state, open check-in, record, schedule) |
| GET | `/attendance` | `attendance.read.all` / `.team` | Records list; `from`, `to` required; filters `employeeId`, `departmentId`, `status`, `needsReview`; `sort=workDate\|-workDate` |
| GET | `/attendance/{employeeId}/{workDate}` | read scopes | Record + all events (evidence) |
| GET | `/attendance/summary` | read scopes | Per-employee counts per status for `from`..`to` (FR-ATT-011) |
| POST | `/attendance/manual-entries` | `attendance.manage` | `{ employeeId, workDate, checkInAt, checkOutAt, reason }` (FR-ATT-009) |
| GET | `/attendance/corrections` | `attendance.correction.review.*` or own | filters `status`, `employeeId` |
| GET | `/attendance/corrections/{id}` | `attendance.correction.review.*` or own | One correction; a correction outside the review scope and not the caller's own returns 404 |
| POST | `/attendance/corrections` | `attendance.correction.request.own` | Creates `pending` + approval request |
| POST | `/attendance/corrections/{id}/approve` | `attendance.correction.review.team` / `.all` | `pending` → `approved`; appends `correction` event |
| POST | `/attendance/corrections/{id}/reject` | same | comment required |
| POST | `/attendance/corrections/{id}/withdraw` | own | `{ version }` |

## 6. Leave

| Method | Path | Permission + scope | Idem. | Notes / transition |
|---|---|---|---|---|
| GET | `/leave/types` | any session | | Active types with current policy summary; with an employee record each type has `eligible` (the create endpoint's eligibility rule, for a leave starting today), otherwise `eligible` is omitted |
| POST | `/leave/types` | `leave.policy.manage` | | |
| PATCH | `/leave/types/{id}` | `leave.policy.manage` | | |
| GET / POST | `/leave/types/{id}/policies` | `leave.policy.manage` | | New policy version, `effectiveFrom` today or later |
| GET | `/leave/balances/me` | `leave.request.own` | | `?year=`; per type: entitled, used, reserved, available |
| GET | `/leave/balances` | `leave.read.all` / `.team` | | `?year&employeeId&departmentId` |
| GET | `/leave/balances/{employeeId}/ledger` | `leave.read.all` / `.team` / own | | `?year&leaveTypeId` |
| POST | `/leave/balances/adjustments` | `leave.balance.adjust`, Strong | key | `{ employeeId, leaveTypeId, year, amount, reason }`; `201` with the balance after the adjustment; a negative amount may not take `available` below zero unless the policy allows it (`422 INSUFFICIENT_BALANCE`) |
| POST | `/leave/requests/preview` | `leave.request.own` (or `leave.request.review.all` with `employeeId`) | | Same body as create; computes working days and balance effect without saving |
| GET | `/leave/requests` | `leave.read.all` / `.team` or own | | filters `status`, `employeeId`, `leaveTypeId`, `from`, `to` |
| POST | `/leave/requests` | `leave.request.own` (or `leave.request.review.all` with `employeeId` = on behalf) | | Creates the request directly in `pending` and posts the reservation (DOMAIN-MODEL 5.3); `draft` is not exposed in v1; `422 INVALID_DATE` (here and in preview) names the field in `errors[0].path` (`/startDate` or `/endDate`) |
| GET | `/leave/requests/{id}` | read scopes or own | | |
| POST | `/leave/requests/{id}/withdraw` | own | | `pending` → `withdrawn`; releases reservation |
| POST | `/leave/requests/{id}/approve` | `leave.request.review.team` / `.all` | key | `pending` → `approved`; release + usage (atomic) |
| POST | `/leave/requests/{id}/reject` | same | | `pending` → `rejected`; comment required |
| POST | `/leave/requests/{id}/cancel` | own (or HR on behalf) | | `approved` → `cancellation_pending`; future or current leave only |
| POST | `/leave/requests/{id}/cancel/approve` | review scopes | key | → `cancelled`; posts reversal |
| POST | `/leave/requests/{id}/cancel/reject` | review scopes | | → `approved`; comment required |
| GET | `/leave/calendar` | `leave.read.all` / `.team`; own team for employees (setting `leave.calendar.visible_to_team`) | | `from`, `to` (max 92 days); optional `departmentId` applies to `leave.read.all` readers only and is ignored for everyone else; shows type only to readers with `leave.read.*` and on the caller's own entries (FR-LEAVE-011); colleagues are employees with the same manager, approved leave only |

## 7. Reimbursements

| Method | Path | Permission + scope | Notes / transition |
|---|---|---|---|
| GET | `/reimbursement-claims` | `reimbursement.read.all`, `.review.team` or own | filters `status`, `employeeId`, `from`, `to`; with `reimbursement.read.all` the response adds `summary.approvedNotIncluded { count, amount }` over the whole company, independent of the filters |
| POST | `/reimbursement-claims` | `reimbursement.request.own` | `draft`; optional receipt `receiptDocumentId` (FR-REIM-001) |
| GET | `/reimbursement-claims/{id}` | same scopes as the list | Claim with `payrollRunNumber` once included (US-REIM-003) |
| PATCH / DELETE | `/reimbursement-claims/{id}` | own, `draft` only | |
| POST | `/reimbursement-claims/{id}/submit` | own | `draft` → `submitted`; `422 INVALID_DATE` for a future date or one older than `reimbursements.max_claim_age_days` |
| POST | `/reimbursement-claims/{id}/withdraw` | own | `submitted` → `withdrawn` |
| POST | `/reimbursement-claims/{id}/approve` | `reimbursement.review.team` / `.all` | `submitted` → `approved` (FR-REIM-002) |
| POST | `/reimbursement-claims/{id}/reject` | same | comment required |

`included` and `paid` are set by payroll, never by an endpoint (FR-REIM-003). A submitted claim cannot be edited (FR-REIM-004).

## 8. Payroll

| Method | Path | Permission | Idem. | Notes / transition |
|---|---|---|---|---|
| GET | `/salary-structures` | `compensation.read.all` or own | | `?employeeId` |
| POST | `/salary-structures` | `compensation.manage`, Strong | | `draft`; `{ employeeId, grossAmount, effectiveFrom, reason }` |
| POST | `/salary-structures/{id}/approve` | `compensation.manage`, Fresh | | `draft` → `approved`; closes previous structure's `effectiveTo` (one starting the same day becomes `superseded`; `422` if a later structure is approved); emits `salary_changed` event |
| GET | `/payroll/periods` | `payroll.read.all` | | |
| POST | `/payroll/periods` | `payroll.prepare` | | `{ year, month }`; dates computed |
| GET | `/payroll/runs` | `payroll.read.all` | | filters `periodId`, `status`; each run carries `preparedByName` and `approvedByName` |
| POST | `/payroll/runs` | `payroll.prepare`, Strong | key | `{ periodId, runType }` → `draft`; `409 PAYROLL_RUN_EXISTS` |
| GET | `/payroll/runs/{id}` | `payroll.read.all` | | Run + totals + validation summary |
| GET | `/payroll/runs/{id}/items` | `payroll.read.all` | | List; `?employeeId&flag` |
| GET | `/payroll/runs/{id}/items/{itemId}` | `payroll.read.all` | | Item + line items + snapshot |
| POST | `/payroll/runs/{id}/calculate` | `payroll.prepare`, Strong | key | `draft`/`calculated` → `calculated`; replaces items; `off_cycle` runs return `422` until their rules are defined |
| POST | `/payroll/runs/{id}/validate` | `payroll.prepare` | | Re-runs validation, returns flags; no state change |
| POST | `/payroll/runs/{id}/submit` | `payroll.prepare`, Strong | key | `calculated` → `submitted`; blocked by blocking flags |
| POST | `/payroll/runs/{id}/return` | `payroll.approve`, Strong | | `calculated`/`submitted` → `returned` → `draft` in one call; `{ reason, version }` |
| POST | `/payroll/runs/{id}/approve` | `payroll.approve`, Fresh | key | `submitted` → `approved`; self-approval needs `selfApprovalNote` (D-007) |
| POST | `/payroll/runs/{id}/lock` | `payroll.lock`, Fresh | key | `approved` → `locked`; marks claims/adjustments |
| GET | `/payroll/runs/{id}/payments` | `payroll.read.all` | | List of every payment of the run (cancelled and failed included), by employee code then newest first; filter `status` |
| POST | `/payroll/runs/{id}/payments` | `payroll.pay`, Fresh | key | Record one payment `{ payrollItemId, method, amount, paidOn, chequeNumber?, acknowledgedByName? }` |
| POST | `/payroll/runs/{id}/payments/import` | `payroll.pay`, Fresh | key | `{ csv }` with header `employeeCode,method,amount,paidOn` plus optional `chequeNumber,reference,acknowledgedByName`; preview with `?dryRun=true`; a file with any row error records nothing (`400`, one error per row) |
| POST | `/payroll/payments/{paymentId}/cancel` | `payroll.pay`, Fresh | | `{ reason, outcome }`, `outcome` `cancelled` (default) or `failed` (bounced cheque); run must be `locked` |
| POST | `/payroll/runs/{id}/mark-paid` | `payroll.pay`, Fresh | | `locked` → `paid` when every item is paid |
| POST | `/payroll/runs/{id}/reconcile` | `payroll.pay`, Fresh | | `paid` → `reconciled` |
| GET | `/payroll/runs/{id}/reconciliation` | `payroll.read.all` | | Gross, deductions, net vs payments per item (FR-PAY-015) |
| POST | `/payroll/runs/{id}/publish-payslips` | `payroll.pay`, Fresh | key | Creates `payslips`; queues emails |
| GET / POST | `/payroll/adjustments` | read `payroll.read.all`; create `payroll.prepare` | key on POST | Each adjustment carries `createdByUserId` and `createdByName` |
| POST | `/payroll/adjustments/{id}/approve` | `payroll.approve`, Fresh | | |
| POST | `/payroll/adjustments/{id}/reject` | `payroll.approve` | | |
| GET | `/payroll/payslips/me` | `payslip.read.own` | | Own published payslips |
| GET | `/payroll/payslips` | `payslip.read.all` | | |
| GET | `/payroll/payslips/{id}` | `payslip.read.all` or own | | Immutable `PayslipData` for browser PDF rendering (D-037), with `payment { method, paidOn, chequeNumber }` from the item's `paid` payment (null while unpaid); sets `firstViewedAt`; audited |

Run transitions, salary-structure approval and adjustment decisions take the `version` the client read (API-STANDARDS §8). Payments are for exactly the item's net amount, one per item (D-042).

The SRS endpoint `GET /payroll/payslips/{id}/download` is replaced by `GET /payroll/payslips/{id}`, because the browser builds the PDF.

## 9. Documents

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/employees/{id}/documents` | `document.read.all`, own (non-restricted), `document.payroll.read` (payroll category) | |
| POST | `/employees/{id}/documents` | `document.manage`; employees may upload `receipt` documents for themselves with `reimbursement.request.own` | multipart; `{ category, title, issueDate?, expiryDate?, isRestricted? }` |
| POST | `/documents/{id}/versions` | `document.manage` | multipart; new version, previous kept; optional `{ issueDate?, expiryDate? }` replace the document's dates |
| GET | `/documents/{id}` | read rules | Metadata + versions |
| GET | `/documents/{id}/download` | read rules | Streams current version (`?version=`); restricted categories audited (FR-DOC-007) |
| POST | `/documents/{id}/delete` | `document.manage`, Fresh | Retention deletion; `{ reason, version }` |
| GET | `/company/documents` | any session (policy category); `document.read.all` sees every category | Company-wide documents |
| POST | `/company/documents` | `document.manage` | multipart, same fields as an employee upload; `employee_id` is NULL |

Read rules: `document.read.all` reads every document; `document.payroll.read` reads the `payslip` category; `document.read.own` reads the caller's own documents that are not flagged `isRestricted`; any session reads non-restricted company documents of the `policy` category. Anything else returns 404. Uploads are limited to `documents.max_upload_mb` (`413 FILE_TOO_LARGE`) and to PDF, PNG, JPEG and WebP content checked by magic bytes, declared type and extension (`415 UNSUPPORTED_FILE_TYPE`).

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
| GET | `/reports/headcount` | `report.hr` | `asOf`, `departmentId`, `groupBy` (`department`, `position`, `status`) |
| GET | `/reports/directory` | `report.hr`, `report.team` | `departmentId`, `status` |
| GET | `/reports/attendance` | `report.hr`, `report.team` | `from`, `to`, `departmentId`, `employeeId` |
| GET | `/reports/leave` | `report.hr`, `report.team` | `year`, `from`, `to`, `leaveTypeId`, `departmentId` |
| GET | `/reports/payroll-register` | `report.payroll` | `runId` |
| GET | `/reports/payroll-deductions` | `report.payroll` | exactly one of `runId` or `year`; `year` counts runs that are `approved` or later |
| GET | `/reports/payment-reconciliation` | `report.payroll` | `runId` |
| GET | `/reports/reimbursements` | `report.payroll`, `report.hr` | `from`, `to` (expense date, required), `status`; `draft` claims never appear |
| POST | `/reports/exports` | the report's permission | `{ report, format?, filters, rowCount }`; audit only; `204` |

`report.team` limits `directory`, `attendance` and `leave` to the caller's direct and indirect reports. `from`/`to` ranges are at most 366 days. Report responses are `{ data, page }`; headcount, payroll and reimbursement reports add a `summary` with totals over the whole result, computed in SQL. `report` in `POST /reports/exports` is one of `headcount`, `directory`, `attendance`, `leave`, `payroll_register`, `payroll_deductions`, `payment_reconciliation`, `reimbursements`; payroll reports are audited in the `payroll` category, the others in `business`.

## 13. Audit and health

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/audit-logs` | `audit.read.all`, `audit.read.payroll` (category payroll), `audit.read.technical` (category technical, security) | `from`, `to` required (Asia/Dhaka dates, inclusive, at most 366 days); `actorUserId`, `action` (prefix), `category`, `entityType`, `entityId`, `employeeId`, `page`, `pageSize` (FR-AUD-005); newest first, with actor names; `metadata` omitted where AUDIT.md §5 hides it |
| GET | `/health` | public | `{ status: "ok" }` only; no dependency details |
| GET | `/health/details` | `system.health.read` | DB latency, last `job_runs` per job, outbox counts by status and oldest pending age, email deliveries today (FR-SET-004) |
| POST | `/admin/jobs/{job}/run` | `system.health.read` + `settings.technical.manage`, Strong | Re-run a daily step `{ runKey?, date? }` (date defaults to today, Asia/Dhaka; the step's calendar check is skipped); returns `outcome` `succeeded`, `skipped` (key already succeeded) or `failed`; `404` for an unknown step; audited `job.run_requested` (JOBS-AND-OUTBOX section 4) |
| GET | `/admin/jobs` | `system.health.read` | Every daily step in dispatcher order with its last run for the caller's company (`lastRun` null when it never ran); audited `job.listed` |
| POST | `/admin/outbox/retry` | `system.health.read` + `settings.technical.manage`, Strong | Sets `next_attempt_at` to now on the company's `failed` messages (`dead` ones stay dead) and sends up to 20 of them after commit; returns `{ reset, processing }`; audited `outbox.retry_requested` |
| GET | `/openapi.json` | public in staging/local; disabled in production | |
