# User stories

The v1 backlog as user stories with acceptance criteria. Every story traces to SRS v1.1 requirement IDs (`SRS-v1.0.md`, `SRS-v1.1-CHANGES.md`). Role codes and permission codenames are the canonical ones in `docs/03-architecture/SECURITY-MODEL.md`; states and enums are those in `docs/03-architecture/DOMAIN-MODEL.md`.

## How to read this file

- **ID:** `US-<MODULE>-NNN`. IDs are stable; a removed story keeps its ID with status "Dropped".
- **Priority:** P0 = required for v1 go-live, P1 = next release. Every story here is P0 unless marked.
- **Acceptance criteria** use Given / When / Then. Each story has at least one negative or permission case; those become API tests (`docs/07-quality/TESTING-STRATEGY.md`).
- "Not found" in a criterion means HTTP 404, which the API returns for records outside the caller's scope (SECURITY-MODEL §1.6).
- A story is done when it meets `docs/09-process/DEFINITION-OF-DONE.md`.

## Accounts and sign-in (`accounts`)

### US-AUTH-001 Invite a user
As an `hr_admin`, I invite a person by email so that they can sign in. FR-AUTH-005.
- Given I hold `user.manage`, when I invite `rina@example.com` and link employee `EMP-0007`, then a user with status `invited` exists, an invitation email is queued in the outbox, and an audit entry records the invite.
- Given an active user already has that email (case-insensitive), when I invite it again, then I get a validation error `EMAIL_TAKEN`.
- Given employee `EMP-0007` is already linked to another user, when I invite and link it, then I get `EMPLOYEE_ALREADY_LINKED` (FR-AUTH-010).
- Given I am a `manager` without `user.manage`, when I call the invite endpoint, then I get 403.

### US-AUTH-002 Accept an invitation
As an invited person, I accept my invitation so that my account becomes active. FR-AUTH-005.
- Given a valid, unexpired invitation, when I open the link and enter the emailed code, then my status becomes `active` and I am signed in.
- Given the invitation expired or was revoked, when I open the link, then I see "This invitation is no longer valid" and no account is activated.

### US-AUTH-003 Sign in with an email code
As a user, I sign in with a one-time code sent to my email. FR-AUTH-001, D-033.
- Given my account is `active`, when I request a code, then a 6-digit code is emailed, it expires after 10 minutes, and only its hash is stored.
- Given I enter a wrong code 5 times, when I try again, then the code is invalidated and I must request a new one.
- Given I request codes faster than the rate limit, when I request again, then I get 429 and no email is sent.
- Given my account is `suspended` or `deactivated`, when I request a code, then the response is identical to the success response (no account enumeration) but no code is sent (FR-AUTH-006).

### US-AUTH-004 Register and use a passkey
As a user, I register a passkey after my first sign-in so that later sign-ins need no email. ADR-0004.
- Given I signed in with an email code and have no passkey, when the dashboard loads, then I am offered "Add a passkey" (dismissible).
- Given I registered a passkey, when I sign in with it, then I get a strong session.
- Given I remove my last passkey, when I confirm, then I can still sign in with email codes.

### US-AUTH-005 Strong session for privileged roles
As the company, I require privileged users to hold a strong session. FR-AUTH-007, D-006.
- Given I hold `payroll_officer` and signed in with an email code only, when I call any endpoint that needs a `payroll.*` permission, then I get 403 with code `MFA_REQUIRED` and the UI asks for my TOTP code.
- Given I enter a valid TOTP code, when I retry, then the request succeeds.
- Given I hold a privileged role and have neither passkey nor TOTP, when I sign in, then I must set up TOTP before reaching any privileged page.

### US-AUTH-006 Account recovery
As a user who lost my passkey device, I recover access with an email code. D-033.
- Given I have no passkey available, when I choose "Use email code instead", then I can sign in with an email code (weak session).
- Given I hold a privileged role and lost my TOTP device, when I use a recovery code, then I get a strong session and the recovery code is consumed.
- Given I hold a privileged role with no recovery codes left, when an `hr_admin` resets my second factor, then the reset is audited and I must enrol TOTP at next sign-in.

### US-AUTH-007 Sign out
As a user, I sign out so that my session ends. FR-AUTH-003.
- Given I am signed in, when I sign out, then my session is revoked on the server and the cookie is cleared.
- Given I reuse the old cookie, when I call `/auth/me`, then I get 401.

### US-AUTH-008 Suspend and deactivate
As an `hr_admin` or `system_admin`, I suspend or deactivate an account. FR-AUTH-005, FR-AUTH-006.
- Given user Karim is `active`, when I suspend him, then all his sessions are revoked immediately and he cannot sign in.
- Given Karim is `deactivated`, when anyone tries to reactivate him, then the API rejects the transition (`deactivated` is final).
- Given Karim's account is deactivated, then his employee record and its history are unchanged (FR-EMP-012).

### US-AUTH-009 Current user
As the frontend, I load the current user so that I can show the right navigation. FR-AUTH-004.
- Given I am signed in, when I call `GET /auth/me`, then I receive my user id, linked employee id (or null), roles, effective permissions, session strength and theme preference.
- Given I am not signed in, then I get 401.

### US-AUTH-010 Assign roles
As a `system_admin`, I assign roles to users. FR-SET-001, FR-SET-005.
- Given I hold `role.manage` and a session from the last 15 minutes, when I assign `payroll_officer` to Nadia, then the assignment is saved and audited with actor, role and target.
- Given my last sign-in was more than 15 minutes ago, when I assign a role, then I must re-authenticate first.
- Given I try to assign `manager` or `employee`, then I get a validation error: those roles are derived.

## Interface preferences (`accounts`)

### US-UI-001 Theme toggle
As any user, I switch between dark and light themes. D-040.
- Given I have never chosen a theme, when I open the app, then it shows the Ink (dark) theme.
- Given I toggle to Paper, when I sign in on another device, then Paper is shown there too (saved on my account).
- Given I toggle the theme, then the page does not reload and there is no flash of the other theme on next load.

## Organization (`organization`)

### US-ORG-001 Company settings
As an `hr_admin`, I set the company name, logo, timezone and currency. FR-ORG-001, FR-ORG-007.
- Given a new installation, then timezone is `Asia/Dhaka` and currency is `BDT`.
- Given I change the timezone, then the change is audited with old and new values (FR-ORG-006).
- Given I am an `employee`, when I call the update endpoint, then I get 403.

### US-ORG-002 Departments and positions
As an `hr_admin`, I manage departments and positions. FR-ORG-002.
- Given I hold `org.manage`, when I create department "Engineering" with code `ENG`, then it is active and selectable on employee forms.
- Given a department has employees, when I deactivate it, then existing employees keep it and it disappears from selection lists for new assignments.
- Given a duplicate code, then I get `DEPARTMENT_CODE_TAKEN`.

### US-ORG-003 Reporting manager
As an `hr_admin`, I set an employee's manager. FR-ORG-003, FR-ORG-004, FR-ORG-005.
- Given I set Rahim's manager to Rahim, then I get `SELF_MANAGER`.
- Given Sumi reports to Rahim, when I set Rahim's manager to Sumi, then I get `REPORTING_CYCLE`.
- Given a valid change, then an employment event `manager_changed` is recorded with its effective date.

### US-ORG-004 Work schedules
As an `hr_admin`, I define work schedules with working days, core window and minimum hours. FR-ATT-003, D-005, D-010.
- Given a new installation, then a default schedule exists with Sunday to Thursday as working days; its core window and minimum hours are empty until the owner sets them.
- Given I assign a schedule to an employee from 1 March, then attendance from 1 March is evaluated with it and earlier dates keep the old schedule.

### US-ORG-005 Holidays
As an `hr_admin`, I maintain the holiday list. FR-ATT-003.
- Given 26 March is a holiday, when an employee requests leave from 25 to 27 March, then 26 March is not counted.
- Given I add a holiday for a date already passed, then attendance records for that date are recalculated and the change is audited.

## Employees (`employees`)

### US-EMP-001 Create an employee
As an `hr_admin`, I create an employee record. FR-EMP-001, FR-EMP-002, FR-EMP-009.
- Given required fields are filled, when I save, then the employee gets the next code (`EMP-0042`) and status `draft`.
- Given a required field is missing, then the error appears next to that field.
- Given the work email is already used by another employee, then I get `WORK_EMAIL_TAKEN`.
- Given I create an employee without a login, then that is valid (FR-AUTH-009).

### US-EMP-002 View and search employees
As an `hr_admin`, `payroll_officer`, `director` or `auditor`, I search the employee list. FR-EMP-007.
- Given 45 employees, when I filter by department and status and sort by joining date, then results are paginated (default 25 per page).
- Given I am a `manager`, when I open the list, then I see only my direct and indirect reports.
- Given I am an `employee` only, when I call `GET /employees/`, then I get 403; I use `/employees/me` instead.

### US-EMP-003 Employee profile
As a user with read access, I open an employee profile. FR-EMP-003, FR-EMP-004.
- Given I am an `hr_admin`, then I see identity, employment and restricted contact data.
- Given I am a `manager` viewing a report, then I see basic and employment data but not restricted contact data or salary.
- Given I am an `employee` and change the URL to another employee's id, then I get 404.
- Given any profile response, then it never contains salary fields; salary is only served by compensation endpoints.

### US-EMP-004 Lifecycle transitions
As an `hr_admin`, I move an employee through lifecycle states. FR-EMP-005, DOMAIN-MODEL §5.2.
- Given an employee in `probation`, when I confirm them effective 1 June, then an employment event `confirmed` is created and the status becomes `active` on 1 June.
- Given an employee in `draft`, when I try to set `separated`, then I get `INVALID_TRANSITION`.
- Given a `separated` employee, when I archive them, then their attendance, leave, payroll and audit history remain readable (FR-EMP-006).

### US-EMP-005 Employment history
As an `hr_admin`, I see the effective-dated history of an employee. FR-EMP-005.
- Given an employee was promoted and transferred, when I open History, then events are listed with type, effective date, actor, old and new values.
- Given I am a `manager`, then I see history for my reports except `salary_changed` events.

### US-EMP-006 Contracts
As an `hr_admin`, I record employment contracts. FR-DOC-009.
- Given I add a `fixed_term` contract with start, end and a document, then it shows on the profile with its status.
- Given a contract end date within the reminder window, then HR receives a reminder email (see US-DOC-004).

### US-EMP-007 CSV import
As an `hr_admin`, I import employees from CSV. FR-EMP-008.
- Given a CSV file, when I upload it, then I see a field mapping step and a preview with per-row errors, before anything is saved.
- Given rows with duplicate work emails or codes, then those rows are flagged and excluded from commit.
- Given I commit, then valid rows are created in one transaction and I can download an error report for the rest.

### US-EMP-008 Profile change request
As an `employee`, I request a change to my profile data. FR-EMP-011, FR-ESS-005.
- Given I hold `profile_change.request.own`, when I request a new emergency contact, then a request is `pending` and HR sees it in the approval inbox.
- Given HR approves, then the change is applied and audited; given HR rejects, then nothing changes and I see the decision.
- Given I try to change my own employee code, department or salary, then the field is not editable through a change request.

### US-EMP-009 Archive
As an `hr_admin`, I archive a separated employee. FR-EMP-006, FR-SET-003.
- Given an archived employee, then they are hidden from default lists but appear with the "Archived" filter.
- Given there is no delete endpoint for employees, then deletion is impossible through the API.

## Attendance (`attendance`)

### US-ATT-001 Check in and check out
As an `employee`, I check in and out from the web app. FR-ATT-001, FR-ATT-002, FR-ATT-012.
- Given I am signed in, when I tap "Check in", then an `attendance_event` `check_in` is stored with server timestamp, source `web`, IP and user agent.
- Given the request body contains an `employeeId`, then it is ignored; the employee comes from my session.
- Given I already checked in today, when I check in again, then I get `ALREADY_CHECKED_IN`.
- Given I have no linked employee record, then the check-in button is not shown and the endpoint returns 403.

### US-ATT-002 Daily status
As the system, I compute each day's attendance status. FR-ATT-004, FR-ATT-005, D-010, D-011.
- Given a working day with check-in 10:05 and check-out 18:10 covering the core window and meeting minimum hours, then the status is `present` and lateness is shown only in reports.
- Given a check-in and no check-out by the end of the day, then the nightly job sets `missing_punch`.
- Given a check-out after midnight, then it is attached to the check-in's work date and the record is flagged for HR review.
- Given an approved leave day, then the status is `on_leave`; given a holiday, `holiday`; given Friday or Saturday, `weekend`.

### US-ATT-003 My attendance
As an `employee`, I see my attendance by month. FR-ESS-001.
- Given I open "My attendance", then I see each day with status, check-in, check-out and worked hours.
- Given I request another employee's attendance through the API, then I get 404.

### US-ATT-004 Request a correction
As an `employee`, I request a correction with a reason. FR-ATT-006.
- Given a day with `missing_punch`, when I propose a check-out time with a reason, then a correction is `pending` and my manager gets an email.
- Given the reason is empty, then I get a validation error on the reason field.
- Given a correction for a future date, then I get `INVALID_DATE`.

### US-ATT-005 Review a correction
As a `manager`, I approve or reject my reports' corrections. FR-ATT-007, FR-ATT-008.
- Given I approve, then a `correction` event is appended, the original events stay, the day is recalculated and the decision is audited.
- Given the request is from someone outside my team, then I get 404.
- Given the request is my own, then I cannot approve it; it routes to `hr_admin`.

### US-ATT-006 Manual attendance
As an `hr_admin`, I record attendance manually with a reason. FR-ATT-009.
- Given I record a `manual_entry` for 3 March with a reason, then it is stored with source `manual`, my user id and the reason, and the day is recalculated.
- Given the reason is missing, then I get a validation error.

### US-ATT-007 Attendance reports
As an `hr_admin` or `manager`, I view daily and monthly attendance reports. FR-ATT-011, FR-REP-002.
- Given I filter by department and month, then I see totals per status per employee.
- Given I am a `manager`, then the report only includes my team.

## Leave (`leave`)

### US-LEAVE-001 Configure leave types and policies
As an `hr_admin`, I configure leave types and policies. FR-LEAVE-001, FR-LEAVE-002, D-013.
- Given seed data, then Casual, Sick, Annual/Earned and Compensatory exist with allocations editable by HR.
- Given I change an allocation effective next year, then current-year balances are unchanged (effective-dated policy).
- Given I hold no `leave.policy.manage`, then the endpoints return 403.

### US-LEAVE-002 View my balances
As an `employee`, I see my leave balances and history. FR-LEAVE-003.
- Given I open "My leave", then each type shows entitlement, used, reserved (pending) and available, derived from the ledger.
- Given I open a type, then I see its ledger entries with dates and references.

### US-LEAVE-003 Request leave
As an `employee`, I request leave. FR-LEAVE-004, FR-LEAVE-005, D-015, D-016.
- Given 2 working days of Casual leave available, when I request Sunday to Monday, then the request is `pending`, 2 days are reserved, and my manager is emailed.
- Given the range includes a Friday, Saturday or holiday, then those days are not counted.
- Given I request a half day, then I must choose `first_half` or `second_half` and 0.5 days are reserved.
- Given the request exceeds my available balance, then I get `INSUFFICIENT_BALANCE`.
- Given the range overlaps an existing pending or approved request, then I get `OVERLAPPING_LEAVE`.

### US-LEAVE-004 Approve or reject leave
As a `manager`, I decide on my team's leave requests. FR-LEAVE-006, FR-LEAVE-007, FR-LEAVE-009, D-014.
- Given I approve, then in one transaction the reservation is released, a `usage` entry is posted, the approval step is recorded with my comment, and the employee is emailed.
- Given two approvals for the same employee run at the same time and the balance covers only one, then exactly one succeeds and the other gets `INSUFFICIENT_BALANCE` (FR-LEAVE-013).
- Given the request is not from my team, then I get 404.
- Given the requester has no manager, then the request appears in the `hr_admin` inbox.
- Given an `hr_admin` decides on behalf of a manager, then the audit entry records "acted on behalf".

### US-LEAVE-005 Withdraw and cancel
As an `employee`, I withdraw a pending request or ask to cancel an approved one. FR-LEAVE-010.
- Given my request is `pending`, when I withdraw it, then it becomes `withdrawn` and the reservation is released.
- Given my request is `approved` and in the future, when I request cancellation, then it becomes `cancellation_pending`; when my manager approves, a `reversal` entry restores the balance.
- Given the manager rejects the cancellation, then the request returns to `approved` and the balance is unchanged.

### US-LEAVE-006 Accrual, carry-forward and expiry
As the system, I post accruals and year-end entries. FR-LEAVE-002, D-015.
- Given a policy with monthly accrual, when the monthly job runs, then one `accrual` entry per eligible employee is posted, and re-running the job posts nothing new (idempotent).
- Given 1 January, when the year-end job runs, then carry-forward and expiry entries follow each policy's limits.

### US-LEAVE-007 Adjust a balance
As an `hr_admin`, I adjust a balance with a reason. FR-LEAVE-008.
- Given I hold `leave.balance.adjust`, when I add 1 Compensatory day with a reason, then an `adjustment` entry is posted and audited.
- Given no reason, then I get a validation error.

### US-LEAVE-008 Leave calendar
As a `manager`, I see my team's approved and pending leave on a calendar. FR-LEAVE-011.
- Given I open the team calendar for March, then I see leave for my reports only, with type and status as text and colour.
- Given I am an `employee`, then I see only my own leave on the calendar in v1.

## Payroll (`payroll`)

### US-PAY-001 Salary structure
As a `payroll_officer`, I set an employee's gross salary with an effective date. FR-PAY-001, FR-PAY-003, D-018.
- Given I set gross 60,000.00 BDT effective 1 July, then a new salary structure is created, the previous one ends 30 June, and a `salary_changed` employment event and audit entry are recorded.
- Given a payroll run for June is already locked, then its snapshot still shows the old salary.
- Given I am an `hr_admin`, then I can read but not change salary structures.
- Given I am an `employee`, then I can read only my own salary structure.

### US-PAY-002 Create a payroll run
As a `payroll_officer`, I create a run for a month. FR-PAY-004, FR-PAY-012.
- Given no regular run exists for November 2026, when I create one, then it is `draft` with run number `PR-2026-11-01`.
- Given a regular run for November already exists and is not `returned`, when I create another regular run, then I get `RUN_EXISTS`.

### US-PAY-003 Calculate
As a `payroll_officer`, I calculate a run. FR-PAY-005, FR-PAY-006, FR-PAY-007, FR-PAY-019, D-022.
- Given an employee with gross 30,000.00 who joined on 16 November (15 of 30 days), then the base line is 15,000.00.
- Given approved transport claims of 1,250.00, then a `reimbursement` earning line of 1,250.00 is added and the claims become `included`.
- Given I click Calculate twice, or retry with the same `Idempotency-Key`, then items are not duplicated.
- Given calculation completes, then every item stores a snapshot of the salary structure, inputs and outputs used.

### US-PAY-004 Validate and submit
As a `payroll_officer`, I validate and submit a run. FR-PAY-008.
- Given an active employee has no salary structure for the period, then validation lists them as a blocking error and Submit is disabled.
- Given an item's net differs from last month's by more than the configured threshold, then validation shows a warning that I must acknowledge.
- Given validation passes, when I submit, then the run becomes `submitted`.

### US-PAY-005 Approve or return
As a `payroll.approve` holder, I approve or return a submitted run. FR-PAY-009, FR-PAY-020, D-007.
- Given I am the `director`, when I approve, then the run becomes `approved` and the decision is audited.
- Given I prepared the run myself, when I approve, then I must enter a justification note and the run is flagged `self_approved`.
- Given I return the run with a comment, then it becomes `returned`, then `draft`, history is kept, and included claims go back to `approved`.

### US-PAY-006 Lock
As a `payroll_officer`, I lock an approved run. FR-PAY-011, FR-PAY-019.
- Given an `approved` run, when I lock it with a recent strong session, then it becomes `locked` and no endpoint can change its items.
- Given someone attempts to edit a locked item, then they get `RUN_LOCKED`.
- Given a mistake is found after lock, then the fix is a `PayrollAdjustment` applied in a later run.

### US-PAY-007 Record payments
As a `payroll_officer`, I record cash and cheque payments. FR-PAY-014, D-021.
- Given a locked run, when I record a cheque payment with number, date and amount for an item, then the payment is `paid`.
- Given I record a cash payment, then a cash acknowledgment reference is required.
- Given every item is paid, then the run becomes `paid` and included claims become `paid`.
- Given a payment amount differs from the item's net, then I get `AMOUNT_MISMATCH` unless I mark it as a partial payment with a reason.

### US-PAY-008 Reconciliation
As a `payroll_officer`, I reconcile the run. FR-PAY-015.
- Given a run, when I open Reconciliation, then I see gross, deductions, net and recorded payments per item and in total, with differences highlighted in text and colour.
- Given all differences are zero, when I mark it reconciled, then the run becomes `reconciled`.

### US-PAY-009 Payslips
As an `employee`, I view and download my payslips. FR-PAY-013, FR-ESS-002, FR-ESS-004, D-037.
- Given a run is `locked` or later, then my payslip for that month appears under "My payslips".
- Given I download it, then the PDF is generated in my browser from the snapshot and shows every line item.
- Given I request another employee's payslip id, then I get 404.

### US-PAY-010 Adjustments
As a `payroll_officer`, I create an addition or deduction for a future run. FR-PAY-011, D-019.
- Given I create a `deduction` of 500.00 with a reason, then it is `pending` until a `payroll.approve` holder approves it.
- Given it is approved, then the next calculated run applies it once and marks it `applied`.

## Reimbursements (`reimbursements`)

### US-REIM-001 Submit a transport claim
As an `employee`, I claim transport costs. FR-REIM-001, D-020.
- Given I enter date, amount 350.00 and a description, and optionally attach a receipt image, then the claim is `submitted` and my manager is emailed.
- Given the amount is zero or negative, then I get a validation error on the amount field.
- Given the receipt is not an allowed type or exceeds 10 MB, then the upload is rejected.

### US-REIM-002 Review a claim
As a `manager`, I approve or reject my team's claims. FR-REIM-002.
- Given I approve, then the claim is `approved` and will be included in the next payroll run.
- Given the claim is my own, then I cannot approve it; it routes to `hr_admin`.
- Given the claim is from outside my team, then I get 404.

### US-REIM-003 Track my claims
As an `employee`, I see the status of my claims. FR-REIM-003, FR-ESS-007.
- Given my claim was paid in the November run, then it shows `paid` with the run number.
- Given my claim was rejected, then I see the decision and comment but not internal notes.

### US-REIM-004 Withdraw a claim
As an `employee`, I withdraw a submitted claim. FR-REIM-004.
- Given my claim is `submitted`, when I withdraw it, then it becomes `withdrawn`.
- Given it is already `approved`, then withdraw is not available.

## Documents (`documents`)

### US-DOC-001 Upload a document
As an `hr_admin`, I upload a document to an employee record. FR-DOC-001, FR-DOC-002, FR-DOC-004.
- Given a PDF of 2 MB with category `contract` and an expiry date, then it is stored privately in R2 with a SHA-256 checksum, uploader and upload date.
- Given a file whose content does not match its extension, then it is rejected.
- Given a file above 10 MB, then it is rejected before upload completes.

### US-DOC-002 Download a document
As an authorized user, I download a document. FR-DOC-003, FR-DOC-007, FR-DOC-008.
- Given I am the employee and the category is visible to me, then the file downloads through an authorized endpoint.
- Given the category is restricted, then my access is audited.
- Given I copy the download link and open it while signed out, then I get 401; no permanent public URL exists.

### US-DOC-003 Replace a document
As an `hr_admin`, I upload a new version. FR-DOC-005.
- Given an existing document, when I upload a replacement, then version 2 is created and version 1 stays downloadable to HR.

### US-DOC-004 Expiry reminders
As an `hr_admin`, I get emails about expiring documents and contracts. FR-DOC-006.
- Given a document expires within the configured window, when the daily job runs, then HR receives one email listing it, and the job does not send it again the next day for the same window.

## Approvals (`approvals`)

### US-WF-001 Approval inbox
As an approver, I see everything waiting for my decision. FR-WF-001, FR-WF-002.
- Given I am a `manager`, then my inbox shows pending leave, corrections and claims from my team, oldest first.
- Given I am an `hr_admin`, then my inbox also shows profile changes and requests from employees without a manager.
- Given I hold no `approval.inbox`, then the inbox is not shown.

### US-WF-002 Decision history
As a requester or auditor, I see an immutable decision history. FR-WF-005, FR-ESS-007.
- Given a request was approved and later cancelled, then both events are shown in order; the first is not edited.
- Given I am the requester, then I see decision, date and public comment, not the approver's internal fields.

## Notifications (`notifications`)

### US-NOTIF-001 Email delivery
As the system, I email users about events that need their attention. FR-WF-006, FR-WF-008, D-025.
- Given a leave request is submitted, then an outbox message is written in the same transaction and the cron job sends it within about one minute.
- Given Gmail returns an error, then the message is retried with backoff and the leave request stays `pending` (no rollback).
- Given a message fails 8 times, then it becomes `dead` and appears on the system health page.

## Reports (`reports`)

### US-REP-001 HR reports
As an `hr_admin` or `director`, I view headcount and directory reports. FR-REP-001, FR-REP-004.
- Given I filter headcount by department and date, then counts by status and department are shown.

### US-REP-002 Payroll reports
As a `payroll_officer` or `director`, I view the payroll register and reconciliation report. FR-REP-003.
- Given I am an `hr_admin`, then the payroll register is not available (no `report.payroll`).

### US-REP-003 Export
As an authorized user, I export a report. FR-REP-005, FR-REP-006, D-037.
- Given I export the attendance report as XLSX, then the file is built in my browser from the same API data I can view.
- Given I am a `manager`, then the export contains only my team.

## Audit (`audit`)

### US-AUD-001 Audit trail
As an `auditor`, I search audit events. FR-AUD-001, FR-AUD-005.
- Given I filter by actor, action, entity and date range, then matching events are listed with metadata.
- Given an audit event, then it contains no codes, tokens or full national IDs (FR-AUD-004).
- Given any user, then no endpoint updates or deletes audit records (FR-AUD-003).
- Given I hold `audit.read.payroll` only, then I see payroll events only.

## Settings and health (`settings`)

### US-SET-001 Settings with history
As a role holder for a settings scope, I change settings and see their history. FR-SET-002, FR-SET-005.
- Given I am a `payroll_officer`, then I can change payroll settings but not HR or technical settings.
- Given any change, then old value, new value, actor and time are kept.

### US-SET-002 System health
As a `system_admin`, I see system health. FR-SET-004, NFR-OPS-006.
- Given I open Health, then I see database reachability, last run and status of each job, outbox backlog and dead messages, and the date of the last successful backup.
- Given I am a `system_admin`, then the health page shows no employee or salary data.

## Open questions (owner)

- Reminder window for document and contract expiry (US-DOC-004, US-EMP-006).
- Validation threshold for net pay change warnings (US-PAY-004).
- Whether managers may see leave of employees outside their team on the calendar (US-LEAVE-008), currently no.
- Whether partial payments are allowed at all (US-PAY-007), currently allowed with a reason.
