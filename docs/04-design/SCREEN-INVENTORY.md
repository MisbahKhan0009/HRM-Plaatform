# Screen inventory

Every screen in v1. Routes and guards are defined in INFORMATION-ARCHITECTURE.md; flows in USER-FLOWS.md; components in COMPONENT-SPECS.md. Each entry lists:

- **Purpose**: the job the screen does.
- **Access**: permission codenames (any one is enough unless stated) from `docs/03-architecture/SECURITY-MODEL.md`.
- **Data**: what is shown.
- **Primary**: the single Red Fill action, or "none".
- **Secondary**: other actions, in display order.
- **States**: loading, empty, error, success. "Standard" means the defaults in section 0.
- **Mobile**: behaviour below 768px.

## 0. Standard states

Unless an entry says otherwise:

| State | Behaviour |
|---|---|
| Loading | Skeletons shaped like the final content (COMPONENT-SPECS.md section 14). No full-page spinner. Primary action disabled until data needed for it has loaded. |
| Empty | Empty state component (section 13) with a one-line explanation and, when the user may act, the primary action. Brand moment: DotGrid + Glow inside the empty-state panel. |
| Error (load) | Inline error panel in the content area: "We couldn't load <thing>." + **Try again**. Request id shown in small mono text for support. Shell and navigation stay usable. |
| Error (action) | Field errors next to fields (FORMS-AND-VALIDATION.md); other errors as an inline alert above the form or a toast for row actions. Message chosen by API error `code` (CONTENT-STYLE.md section 6). |
| Not found / no access | 404 page (brand moment) with a link to the dashboard. Same page for both, matching the API. |
| Success | Toast for row-level and dialog actions; redirect to the created record for create flows. |

## 1. Auth zone

All auth screens are brand moments: Ink ground with DotGrid + Glow (Paper if the user previously chose it on this device), centred card 400px wide, logo lockup above the card.

### 1.1 Sign in `/sign-in`
- **Purpose**: start sign-in.
- **Access**: public.
- **Data**: company logo; email field.
- **Primary**: Send code.
- **Secondary**: Sign in with a passkey.
- **States**: loading only on submit (button spinner); `RATE_LIMITED` inline alert.
- **Mobile**: card becomes full width with 16px gutters.

### 1.2 Verify code `/sign-in/verify`
- **Purpose**: enter the emailed code.
- **Data**: email the code was sent to (masked: `m•••@gmail.com`), code input, resend countdown.
- **Primary**: Verify.
- **Secondary**: Send a new code; Use a different email.
- **States**: wrong or expired code as field error.

### 1.3 Two-factor `/sign-in/two-factor`
- **Purpose**: TOTP or recovery code step-up.
- **Primary**: Verify.
- **Secondary**: Use a recovery code / Use authenticator code (toggle); Sign out.

### 1.4 Accept invitation `/accept-invite/$token`
- **Purpose**: first sign-in from an invitation.
- **Data**: company name, invitee name and email.
- **Primary**: Continue.
- **States**: expired or revoked token: error panel, no actions except Back to sign in.

### 1.5 Recover account `/recover`
- **Purpose**: regain access when no passkey or authenticator is available.
- **Data**: explanation; email field.
- **Primary**: Send code. After the code: privileged users enter a recovery code; others continue.
- **Secondary**: Contact HR (shows text, not a link, since there is no support inbox in v1).

## 2. Dashboard and me

### 2.1 Dashboard `/dashboard`
- **Purpose**: role-aware home. Widgets and primary-action rule: INFORMATION-ARCHITECTURE.md section 5.
- **Access**: signed in.
- **States**: each widget loads and fails independently (widget-level skeleton and error with Try again).
- **Mobile**: single column; Today's attendance first.

### 2.2 My profile `/me`
- **Purpose**: view own employee record.
- **Access**: `employee.read.own`.
- **Data**: name, employee code, department, position, manager, joining date, employment status, work email, contact and emergency contacts (own), contract summary.
- **Primary**: none.
- **Secondary**: Request a change (per section).
- **States**: user without employee link: empty state "Your account isn't linked to an employee record." with no action.
- **Mobile**: sections stack; each section is a card.

### 2.3 My compensation `/me/compensation`
- **Access**: `compensation.read.own`.
- **Data**: current gross monthly salary (BDT), effective from, history of salary structures (effective dates and amounts).
- **Primary**: none.
- **Empty**: "No salary structure yet."

### 2.4 My profile changes `/me/profile-changes`
- **Access**: `profile_change.request.own`.
- **Data**: list of requests: section, submitted date, status badge, decision comment.
- **Primary**: Request a change.
- **Secondary**: Withdraw (row, `pending` only).

### 2.5 Security `/me/security`
- **Access**: signed in. Also used as the restricted enrolment gate (USER-FLOWS.md 1.3).
- **Data**: passkeys (name, created, last used), authenticator app (on/off), recovery codes (count remaining), active sessions (device, browser, last active, current marker).
- **Primary**: Add a passkey.
- **Secondary**: Set up authenticator app; Regenerate recovery codes (re-auth); Remove passkey (row); Sign out session (row); Sign out all other sessions.
- **States**: removing the last strong factor for a privileged user is blocked with an inline explanation.

### 2.6 Preferences `/me/preferences`
- **Access**: signed in.
- **Data**: theme (Ink, Paper) as a two-option radio group with previews; language (English; Bangla shown disabled with "Coming later").
- **Primary**: none (changes save immediately, toast "Preferences saved").

## 3. Attendance

### 3.1 My attendance `/attendance`
- **Purpose**: check in/out and review own attendance.
- **Access**: `attendance.read.own`; check-in panel `attendance.check_in.own`.
- **Data**: today panel (status, times, worked time, core window); month calendar with a status badge per day; list of my corrections.
- **Primary**: Check in / Check out.
- **Secondary**: Request correction (on a selected day); month picker.
- **Empty**: new employee with no records: calendar shows days with `not_employed` before joining date.
- **Mobile**: today panel pinned at top; calendar becomes a vertical day list.

### 3.2 Team attendance `/attendance/team`
- **Access**: `attendance.read.team`.
- **Data**: date picker (default today); table of reports: name, status badge, check-in, check-out, worked time, leave type if on leave. Summary counts above.
- **Primary**: none.
- **Secondary**: Change date; filter by status; open employee.
- **Mobile**: card list.

### 3.3 Attendance records `/attendance/records`
- **Access**: `attendance.read.all`; manual entry `attendance.manage`.
- **Data**: filterable table (date range, department, employee, status): employee, work date, status, check-in, check-out, worked minutes, flags (manual, corrected, after-midnight).
- **Primary**: Add manual entry (`attendance.manage`).
- **Secondary**: Export (CSV/XLSX, built in browser); view events (row drawer showing immutable events).
- **Mobile**: card list; manual entry in a full-screen sheet.

## 4. Leave

### 4.1 My leave `/leave`
- **Access**: `leave.request.own`.
- **Data**: balances StatBar (available, reserved, used per type); requests table: number, type, dates, days, status, submitted.
- **Primary**: Request leave.
- **Secondary**: Leave calendar; filter by year and status.
- **Empty**: "You haven't requested any leave this year."

### 4.2 New leave request `/leave/new`
- **Data**: form (USER-FLOWS.md 5.1) with live preview of working days and balance after request.
- **Primary**: Submit request.
- **Secondary**: Cancel (returns to `/leave`, guard dialog if dirty).
- **Mobile**: full-screen form; date range picker opens as a bottom sheet.

### 4.3 Leave request detail `/leave/requests/$requestId`
- **Access**: owner, team approver, or `leave.read.all`.
- **Data**: header with `LV-000123` and status; details; balance impact; approval timeline (COMPONENT-SPECS.md section 16).
- **Primary**: depends on viewer and state: owner + `pending`: none (Withdraw is secondary); owner + `approved` before start: Request cancellation as secondary; approver + `pending`: Approve.
- **Secondary**: Withdraw; Request cancellation; Reject (approver).

### 4.4 Leave calendar `/leave/calendar`
- **Access**: `leave.read.team`, `leave.read.all`, or own.
- **Data**: month grid; each person a row (desktop) with leave bars labelled by type and status (approved solid, pending outlined with "Pending" text); holidays column-highlighted with name.
- **Primary**: none.
- **Secondary**: Month navigation; department filter (`leave.read.all`).
- **Mobile**: agenda list by day.

### 4.5 Leave management `/leave/manage`
- **Access**: `leave.read.all`; adjustments `leave.balance.adjust`; act on behalf `leave.request.review.all`.
- **Data**: tabs: Requests (all, filterable), Balances (employee × type with available, reserved, used, carried forward), Ledger (per employee, read-only entries with type, amount, reference, effective date).
- **Primary**: Adjust balance (Balances tab only).
- **Secondary**: Export; open request; act on behalf (opens approval with banner).

## 5. Reimbursements

### 5.1 My claims `/reimbursements`
- **Access**: `reimbursement.request.own`.
- **Data**: table: date of travel, amount, status, payroll period when included or paid.
- **Primary**: New claim.
- **Empty**: "No claims yet. Submit transport costs here and they're paid with your salary."

### 5.2 New claim `/reimbursements/new`
- **Primary**: Submit claim. **Secondary**: Save draft; Cancel.

### 5.3 Claim detail `/reimbursements/$claimId`
- **Data**: amount, date, description, receipt (download), status, linked payroll run, timeline.
- **Primary**: approver + `submitted`: Approve; otherwise none.
- **Secondary**: Withdraw (owner, `submitted`); Reject (approver).

### 5.4 Claims management `/reimbursements/manage`
- **Access**: `reimbursement.read.all`; review `reimbursement.review.all`.
- **Data**: all claims with filters (status, period, department), totals of approved-not-yet-included.
- **Primary**: none. **Secondary**: Export; open claim.

## 6. Payslips and documents

### 6.1 My payslips `/payslips`
- **Access**: `payslip.read.own` (or `payslip.read.all` with an employee filter).
- **Data**: list: period, net pay, published date.
- **Primary**: none. **Secondary**: View; Download PDF (generated in the browser).
- **Empty**: "No payslips yet. They appear here once payroll for a month is published."

### 6.2 Payslip `/payslips/$payslipId`
- **Data**: company header (logo for the theme in use; the PDF always uses the Paper lockup), employee, period, days employed, earnings lines, deduction lines, net pay, payment method and date.
- **Primary**: Download PDF. **Secondary**: Print.
- **Mobile**: stacked layout; download opens the share sheet where supported.

### 6.3 My documents `/documents`
- **Access**: `document.read.own`.
- **Data**: documents visible to the employee: title, category, issue and expiry dates, current version date.
- **Primary**: none. **Secondary**: Download.

## 7. Approvals

### 7.1 Approval inbox `/approvals`
- **Access**: `approval.inbox`.
- **Data**: list of approval items (COMPONENT-SPECS.md section 15) grouped or filtered by subject type (`leave_request`, `attendance_correction`, `reimbursement_claim`, `profile_change`, `payroll_run`, `payroll_adjustment`); oldest first; age shown.
- **Primary**: none (each item opens its detail).
- **Secondary**: filter by type; tabs Waiting / Decided by me.
- **Empty**: "Nothing waiting for you." (brand moment).
- **Mobile**: full-width item cards; swipe actions are not used (explicit buttons only).

### 7.2 Approval detail `/approvals/$approvalId`
- **Data**: subject summary rendered by type (same blocks as the subject's detail page), requester, submitted date, history.
- **Primary**: Approve.
- **Secondary**: Reject (comment required); Open full record.
- **States**: already decided by someone else: banner "This was <approved/rejected> by <name> on <date>." and actions hidden.

## 8. Employees

### 8.1 Employee directory `/employees`
- **Access**: `employee.read.all` or `employee.read.team`.
- **Data**: table: code, name, department, position, manager, status badge, joining date. Filters: status (default excludes `archived`), department, position, manager. Search by name, code or work email (FR-EMP-007).
- **Primary**: Add employee (`employee.manage`).
- **Secondary**: Import CSV; Export; column visibility.
- **Mobile**: card list with name, code, position, status.

### 8.2 New employee `/employees/new`
- **Data**: multi-section form: identity, employment (department, position, manager, joining date, schedule, contract), contact, emergency contact. Employee code suggested by the server, editable by HR.
- **Primary**: Create employee (creates `draft` or `preboarding`).
- **Secondary**: Cancel.

### 8.3 Import employees `/employees/import`
- **Data**: steps: upload CSV, map columns, preview with per-row validation (errors, duplicates), commit (FR-EMP-008).
- **Primary per step**: Upload file; Continue; Import N employees.
- **Secondary**: Download error report (CSV, built in browser); Back.

### 8.4 Employee profile `/employees/$employeeId`
- **Data**: header with name, code, status badge, position, department. Tabs:
  - Overview: key facts, account status (invited, active ...), manager, reports count.
  - Employment: effective-dated history and contracts.
  - Contact: restricted fields (`employee.contact.read.all`).
  - Documents: list, versions, upload (`document.manage`).
  - Attendance: month view (read).
  - Leave: balances and requests.
  - Compensation (`compensation.read.all`): salary structures.
  - History: audit-style timeline of changes.
- **Primary**: Edit (Overview tab, `employee.manage`); Upload document (Documents tab); Add salary structure (Compensation tab, `compensation.manage`). One per tab.
- **Secondary**: More menu: Invite to sign in, Record employment event, Start separation, Archive.
- **Mobile**: tabs become a select; header compresses.

## 9. Payroll

### 9.1 Payroll runs `/payroll`
- **Access**: `payroll.read.all`.
- **Data**: runs table: run number, period, type, status badge, employees, net total, prepared by, approved by, self-approved flag.
- **Primary**: Create payroll run (`payroll.prepare`).
- **Secondary**: filter by year and status.

### 9.2 Payroll run `/payroll/runs/$runId`
- **Data**: header: run number, period, status badge, self-approved badge if set; totals StatBar (employees, gross, deductions, net). Tabs: Items, Validation, Adjustments, Payments, Reconciliation, History.
- **Primary** by status and permission: `draft`: Calculate; `calculated`: Submit for approval (Calculate becomes secondary "Recalculate"); `submitted`: Approve run (approver); `approved`: Lock run; `locked`: Record payment (Payments tab) or Publish payslips (header, if not yet published); `paid`: Mark as reconciled.
- **Secondary**: Return to draft; Export register; Recalculate; Run checks.
- **States**: read-only banner from `locked` onward: "This run is locked. Corrections go into an adjustment in a later run."
- **Mobile**: read-only summary and approvals work on mobile; editing payments is supported in a full-screen sheet; the items table becomes cards.

### 9.3 Salary structures `/payroll/salary-structures`
- **Access**: `compensation.read.all`; edit `compensation.manage`.
- **Data**: employees with current gross, effective from, last change; row drawer with history.
- **Primary**: Add salary structure.
- **Secondary**: Export.
- **States**: adding a structure with an effective date inside a locked period shows a warning that it applies from the next unlocked period only (FR-PAY-003).

### 9.4 Payroll adjustments `/payroll/adjustments`
- **Access**: `payroll.read.all`; create `payroll.prepare`; approve `payroll.approve`.
- **Data**: adjustments: employee, type (`addition` or `deduction`), amount, reason, status, target run.
- **Primary**: New adjustment.

## 10. Reports and audit

### 10.1 Reports index `/reports`
- **Data**: cards for each report the user may open, with a one-line description.
- **Primary**: none.

### 10.2 Report pages `/reports/headcount`, `/reports/attendance`, `/reports/leave`, `/reports/payroll`, `/reports/reimbursements`
- **Data**: filters (date range, department; payroll: period), summary StatBar, result table, optional simple chart (bars only; see the `dataviz` guidance when built).
- **Primary**: Export (CSV or XLSX, built in the browser from permission-filtered data).
- **Secondary**: Reset filters.
- **States**: large result sets: paginated on screen; export fetches all pages with a progress indicator and can be cancelled.

### 10.3 Audit log `/audit`
- **Access**: `audit.read.all`, `audit.read.payroll`, `audit.read.technical`.
- **Data**: filters: date range, actor, action, entity type, entity id (FR-AUD-005); table: time, actor, action, entity, summary; row drawer with changed fields.
- **Primary**: none. **Secondary**: Export.

## 11. Settings

All settings pages share a layout: settings sub-navigation on the left (top select on mobile), form or table on the right. Pages are read-only for users who have `settings.read` but not the edit permission; the primary action is hidden for them.

| Route | Data | Primary | Edit permission |
|---|---|---|---|
| `/settings/company` | name, logo, contact, timezone (default `Asia/Dhaka`), currency (BDT), working days | Save changes | `settings.technical.manage` / `settings.hr.manage` per field group |
| `/settings/departments` | name, code, active | Add department | `org.manage` |
| `/settings/positions` | title, department, grade | Add position | `org.manage` |
| `/settings/work-schedules` | name, working days (default Sun to Thu, D-005), core window, minimum daily minutes; assignments count | Add schedule | `settings.hr.manage` |
| `/settings/holidays` | year view: date, name, type | Add holiday | `settings.hr.manage` |
| `/settings/leave-types` | leave types and effective-dated policies (allocation, accrual, carry-forward, expiry, half-day allowed, reason required) | Add leave type | `leave.policy.manage` |
| `/settings/payroll` | run number prefix, validation thresholds, payslip publication options | Save changes | `settings.payroll.manage` |
| `/settings/users` | users: name, email, status, roles, MFA set up, last sign-in | Invite user | `user.manage` |
| `/settings/roles` | roles and permission grants matrix | Save changes (re-auth) | `role.manage` |
| `/settings/system` | job runs (last run, status, duration), outbox (pending, failed, dead), email delivery failures, free-tier usage (Neon storage, R2 storage, daily emails) | Retry failed messages | `system.health.read` |

Effective-dated settings (schedules, leave policies) never edit history: saving creates a new version with an effective-from date, shown in a version list.

## Open questions (owner)

- Payslip content beyond the snapshot fields (company address, employee bank details are not collected in v1 since payment is cash or cheque). Confirm the payslip header fields.
- Whether managers see the worked-time numbers of their reports or only the status.
