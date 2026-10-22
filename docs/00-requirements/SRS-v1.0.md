# Software Requirements Specification (SRS)
## Internal Human Resource Management System (HRM)
**Version:** 1.0  
**Date:** 23 October 2026  
**Status:** Initial product specification  
**Target organization:** One company in Bangladesh with fewer than 50 employees

---

## 1. Introduction

### 1.1 Purpose
This document defines the functional and non-functional requirements for an internal Human Resource Management System (HRM). It is intended for product owners, developers, designers, testers, and company stakeholders.

The system will centralize employee records and support attendance, leave, payroll, approvals, documents, employee self-service, and reporting in one secure application.

### 1.2 Product scope
The product is a single-company internal application. It is not a multi-tenant SaaS product. It should be simple enough for a small organization to operate without a dedicated IT team, while preserving reliable audit history and access controls.

### 1.3 Objectives
- Maintain a single authoritative employee record.
- Reduce manual HR administration and spreadsheet dependence.
- Make attendance, leave, and approval status transparent.
- Support controlled monthly payroll preparation, approval, payment tracking, and payslip publication.
- Provide employees with self-service access to their own information.
- Protect sensitive personal, salary, banking, and employment data.
- Produce reliable reports and traceable records of important changes.

### 1.4 Definitions
- **HRM:** Human Resource Management.
- **ESS:** Employee Self-Service.
- **RBAC:** Role-Based Access Control.
- **PTO:** Paid Time Off / paid leave, according to company policy.
- **Payroll period:** A defined period for which salary is calculated, normally a calendar month.
- **Effective date:** The date on which a change becomes applicable.
- **Ledger:** A history of additions, deductions, reversals, and adjustments used to derive a balance.
- **MUST / SHOULD / MAY:** Requirement priority terms. MUST is mandatory for release; SHOULD is strongly recommended; MAY is optional.

### 1.5 Assumptions and constraints
- The organization has fewer than 50 employees.
- The primary operating market is Bangladesh.
- The primary currency is Bangladeshi taka (BDT).
- The default business timezone is `Asia/Dhaka`, configurable by an authorized administrator.
- The initial interface language is English, with architecture ready for Bangla localization.
- The application is browser-based and responsive on desktop, tablet, and mobile.
- One person may hold multiple roles, but permissions must be explicitly assigned.
- Applicable payroll and employment rules must be verified with qualified local advisers before production use.
- The initial system will not execute bank transfers directly; it will record payment details and support export/reconciliation.

---

## 2. Overall description

### 2.1 Product perspective
The HRM is a modular web application backed by a relational database. All functional modules use the same employee identity and authorization rules.

### 2.2 User classes
1. **System Administrator:** Manages accounts, roles, technical settings, and system health. Technical administration does not automatically grant access to salary data.
2. **HR Administrator:** Manages employee records, employment lifecycle, attendance, leave, documents, and HR reporting.
3. **Payroll / Finance Officer:** Manages salary structures, payroll calculations, deductions, payment records, and payroll reports.
4. **Manager:** Views permitted team information and reviews assigned leave, attendance corrections, and other requests.
5. **Employee:** Views and manages permitted personal information, attendance, leave requests, payslips, and documents.
6. **Auditor / Read-only Reviewer:** Reads explicitly authorized records and audit reports without changing operational data.

### 2.3 Operating environment
- Modern browsers: current stable versions of Chrome, Edge, Firefox, and Safari where practical.
- Backend: Python and Django.
- API: Django REST Framework, versioned under `/api/v1/`.
- Database: PostgreSQL.
- Frontend: Vue 3 / Nuxt with TypeScript (or another explicitly approved frontend framework).
- Private object storage for uploaded documents and generated files.
- HTTPS in all non-local environments.

### 2.4 Design principles
- Secure by default and least privilege.
- Server-side permission enforcement.
- One authoritative employee record.
- Effective-dated policies and salary changes.
- Financial records are auditable and finalized payroll is not silently editable.
- Responsive, accessible, and straightforward UI.
- Prefer a modular monolith over microservices at this scale.

### 2.5 Out of scope for initial release
- Multi-tenant SaaS subscriptions and tenant billing.
- Full applicant tracking / recruitment system.
- Full learning management system.
- Automated bank disbursement.
- Biometric hardware integration (may be added later).
- Native Android or iOS apps.
- AI-based hiring, performance, promotion, or termination decisions.
- Complex enterprise workforce planning.

---

## 3. Functional requirements

Priority levels: **P0** = required for initial production release; **P1** = next release; **P2** = optional/future.

### 3.1 Authentication and account management — P0

- **FR-AUTH-001:** The system MUST allow authorized users to sign in securely.
- **FR-AUTH-002:** The system MUST provide a secure password-reset flow.
- **FR-AUTH-003:** Users MUST be able to sign out and invalidate their active session.
- **FR-AUTH-004:** The system MUST expose a current-user endpoint that returns the user's permitted identity, employee link, roles, and capabilities.
- **FR-AUTH-005:** Administrators MUST be able to invite, activate, suspend, and deactivate user accounts.
- **FR-AUTH-006:** The system MUST prevent suspended or deactivated users from authenticating.
- **FR-AUTH-007:** The system SHOULD support MFA for administrators and payroll approvers.
- **FR-AUTH-008:** The system MUST use secure session handling, password hashing, CSRF protections where applicable, and rate limiting for authentication-sensitive endpoints.
- **FR-AUTH-009:** An employee record MUST be allowed to exist without a login account.
- **FR-AUTH-010:** A user's linked employee record MUST be unique when the one-to-one relationship is enabled.

### 3.2 Organization settings — P0

- **FR-ORG-001:** Authorized administrators MUST configure company name, logo, contact information, timezone, currency, working days, and standard work schedules.
- **FR-ORG-002:** The system MUST support departments and positions/designations.
- **FR-ORG-003:** The system MUST support a reporting manager for an employee.
- **FR-ORG-004:** The system MUST prevent an employee from being their own manager.
- **FR-ORG-005:** The system SHOULD detect reporting cycles before a manager relationship is saved.
- **FR-ORG-006:** Configuration changes affecting payroll, leave, or attendance MUST be audited.
- **FR-ORG-007:** The system MUST use BDT as the default currency and `Asia/Dhaka` as the default timezone, with authorized configuration where needed.

### 3.3 Employee records — P0

- **FR-EMP-001:** HR MUST be able to create, view, update, and archive employee records.
- **FR-EMP-002:** Each employee MUST have a unique human-readable employee code, such as `EMP-0001`.
- **FR-EMP-003:** Employee profiles MUST support identity, contact, emergency contact, employment, department, position, manager, joining date, employment status, and required documents.
- **FR-EMP-004:** Salary details MUST be separately permissioned from ordinary profile information.
- **FR-EMP-005:** The system MUST maintain effective-dated employment history for promotions, transfers, status changes, and other significant events.
- **FR-EMP-006:** Archiving an employee MUST NOT erase linked attendance, leave, payroll, payment, or audit history.
- **FR-EMP-007:** The system MUST support employee search, filtering, sorting, and paginated lists.
- **FR-EMP-008:** The system SHOULD support CSV import with field mapping, preview, validation, duplicate detection, and an error report.
- **FR-EMP-009:** The system MUST validate required fields and enforce unique employee codes and work email addresses where provided.
- **FR-EMP-010:** Personal information collection MUST be limited to fields needed for legitimate company operations.
- **FR-EMP-011:** Employees MAY submit profile-change requests; sensitive changes MUST require verification or authorized review.
- **FR-EMP-012:** Employee lifecycle states MUST be distinct from login-account states.

### 3.4 Employment contracts and documents — P0 basic; P1 advanced

- **FR-DOC-001:** Authorized users MUST upload documents against an employee record.
- **FR-DOC-002:** Documents MUST have metadata including category, upload date, uploader, and optional issue/expiry dates.
- **FR-DOC-003:** Documents MUST be stored privately and downloaded only after authorization.
- **FR-DOC-004:** The system MUST support common approved formats and enforce file-size and file-type limits.
- **FR-DOC-005:** The system SHOULD maintain document versions and checksums.
- **FR-DOC-006:** The system SHOULD notify authorized HR users of approaching document or contract expiry.
- **FR-DOC-007:** The system MUST audit access to sensitive documents where appropriate.
- **FR-DOC-008:** The system MUST NOT expose private documents through public, permanent URLs.
- **FR-DOC-009:** Contract records MUST support contract type, start date, end date, status, and associated document.
- **FR-DOC-010:** Retention and deletion must follow an approved company policy and applicable law.

### 3.5 Attendance and schedules — P0

- **FR-ATT-001:** Employees MUST be able to check in and check out through the web application.
- **FR-ATT-002:** The system MUST record timestamp, source, employee, and relevant attendance event metadata.
- **FR-ATT-003:** The system MUST support configurable work schedules, working days, breaks, and holidays.
- **FR-ATT-004:** The system MUST calculate daily attendance using the assigned schedule and company timezone.
- **FR-ATT-005:** The system MUST identify missing punches, late arrivals, early departures, and incomplete records according to configured policy.
- **FR-ATT-006:** Employees MUST be able to submit attendance correction requests with a reason.
- **FR-ATT-007:** Authorized managers or HR users MUST be able to approve or reject correction requests with a recorded decision.
- **FR-ATT-008:** Original attendance evidence MUST remain available after a correction; the correction MUST be auditable.
- **FR-ATT-009:** Authorized HR users MUST be able to record attendance manually with a reason.
- **FR-ATT-010:** The system SHOULD support approved overtime recording and review.
- **FR-ATT-011:** The system MUST support daily and monthly attendance reports.
- **FR-ATT-012:** Check-in/out endpoints MUST derive the employee from the authenticated user, not trust a client-supplied employee ID.
- **FR-ATT-013:** The system MUST define how overnight shifts and multiple shifts per day are handled before implementation.
- **FR-ATT-014:** Closed payroll periods MUST not be silently changed by attendance corrections; corrections must trigger an authorized adjustment process.

### 3.6 Leave management — P0

- **FR-LEAVE-001:** Authorized HR users MUST configure leave types and policies.
- **FR-LEAVE-002:** Policies MUST support allocation, accrual, eligibility, paid/unpaid classification, carry-forward, expiry, and units as applicable.
- **FR-LEAVE-003:** Employees MUST be able to view their own leave balances and history.
- **FR-LEAVE-004:** Employees MUST be able to submit leave requests with dates, leave type, unit/duration, and reason where required.
- **FR-LEAVE-005:** The system MUST validate date ranges, policy eligibility, working days, holidays, and available balance according to company rules.
- **FR-LEAVE-006:** The system MUST prevent unauthorized users from approving requests.
- **FR-LEAVE-007:** The system MUST record approval/rejection decisions, approver, timestamp, and comments where provided.
- **FR-LEAVE-008:** The system MUST maintain a leave ledger for grants, accruals, usage, adjustments, reversals, and encashment where supported.
- **FR-LEAVE-009:** Leave approval and ledger updates MUST be atomic.
- **FR-LEAVE-010:** The system MUST support cancellation requests and controlled reversal of previously posted leave entries.
- **FR-LEAVE-011:** The system SHOULD provide a team/company leave calendar subject to permissions.
- **FR-LEAVE-012:** The company MUST configure whether pending leave requests reserve available balance.
- **FR-LEAVE-013:** The system MUST prevent concurrent approvals from causing an invalid negative balance unless an authorized policy exception applies.

### 3.7 Payroll and compensation — P0, subject to validated rules

- **FR-PAY-001:** Authorized users MUST define salary structures with effective dates.
- **FR-PAY-002:** Salary structures MUST support configurable earnings and deduction components.
- **FR-PAY-003:** The system MUST preserve salary history and prevent a new salary structure from rewriting historical payroll.
- **FR-PAY-004:** The system MUST support monthly payroll periods.
- **FR-PAY-005:** The system MUST calculate draft payroll from effective salary structures and approved inputs.
- **FR-PAY-006:** Payroll calculation MUST use decimal arithmetic and explicit currency.
- **FR-PAY-007:** Each payroll item MUST preserve a snapshot of the salary components, policy versions, inputs, and calculation outputs used.
- **FR-PAY-008:** The system MUST validate missing inputs, anomalous amounts, duplicate employees, and totals before submission.
- **FR-PAY-009:** Payroll MUST follow a controlled lifecycle: Draft, Calculated, Submitted, Approved, Locked, and Paid/Reconciled as applicable.
- **FR-PAY-010:** Only authorized users may calculate, approve, lock, publish, or correct payroll.
- **FR-PAY-011:** A locked payroll MUST NOT be silently edited. Corrections MUST use an authorized adjustment or reversal.
- **FR-PAY-012:** The system MUST prevent duplicate payroll items for an employee within the same run.
- **FR-PAY-013:** The system MUST support itemized payslips and employee-authorized download.
- **FR-PAY-014:** The system MUST record payment method, amount, reference, date, and payment status without claiming that a bank transfer occurred unless confirmed.
- **FR-PAY-015:** The system MUST reconcile gross pay, deductions, net pay, and recorded payments.
- **FR-PAY-016:** The system SHOULD support arrears, bonuses, loans, advances, installments, reimbursements, and final settlement through controlled rules.
- **FR-PAY-017:** Statutory tax and employment rules MUST be configurable, versioned, and verified by qualified local advisers before production use.
- **FR-PAY-018:** Salary, bank, tax, and payroll data MUST have stricter permissions than ordinary employee data.
- **FR-PAY-019:** Payroll calculation and locking operations MUST be transactional and safe against duplicate retries.
- **FR-PAY-020:** If the same person prepares and approves payroll, the system MUST record that exception and preserve review evidence; separation of duties is preferred.

### 3.8 Employee self-service — P0

- **FR-ESS-001:** Employees MUST see a dashboard with their permitted attendance, leave, tasks, and notices.
- **FR-ESS-002:** Employees MUST only see their own payslips and private records unless separately authorized.
- **FR-ESS-003:** Employees MUST be able to submit leave and attendance correction requests.
- **FR-ESS-004:** Employees MUST be able to download authorized documents and payslips.
- **FR-ESS-005:** Employees SHOULD be able to submit profile update requests.
- **FR-ESS-006:** The interface MUST be usable on small mobile screens.
- **FR-ESS-007:** Request status and decisions MUST be visible to the requester without revealing confidential reviewer information.

### 3.9 Approvals and notifications — P0 basic

- **FR-WF-001:** The system MUST provide an approval inbox for each authorized approver.
- **FR-WF-002:** Approval rules MUST identify eligible approvers by manager relationship, assigned role, or explicit configuration.
- **FR-WF-003:** Approvers MUST be able to approve or reject requests with an optional or required comment according to policy.
- **FR-WF-004:** Users MUST NOT approve their own requests unless an explicitly configured, audited exception is allowed.
- **FR-WF-005:** Approval decisions MUST be immutable in the history; a later reversal must create a new event.
- **FR-WF-006:** The system SHOULD notify users about submissions, decisions, upcoming expiries, and pending approvals.
- **FR-WF-007:** Notifications SHOULD support in-app and email delivery.
- **FR-WF-008:** Notification failure MUST NOT silently undo a successfully committed business transaction.
- **FR-WF-009:** Critical operations MUST use explicit backend state-transition validation.

### 3.10 Reports and audit — P0

- **FR-REP-001:** Authorized users MUST be able to view headcount and employee directory reports.
- **FR-REP-002:** Authorized users MUST be able to generate attendance and leave reports.
- **FR-REP-003:** Authorized payroll users MUST be able to generate payroll registers, deduction reports, and payment reconciliation reports.
- **FR-REP-004:** Reports MUST support relevant date and department filters.
- **FR-REP-005:** Authorized users SHOULD export permitted reports to CSV/XLSX; PDF output MAY be supported.
- **FR-REP-006:** Exports MUST enforce the same data permissions as the UI and API.
- **FR-AUD-001:** The system MUST record actor, action, timestamp, entity reference, and relevant change metadata for sensitive operations.
- **FR-AUD-002:** Audit records MUST include salary changes, payroll transitions, permission changes, sensitive document access where appropriate, and employee lifecycle changes.
- **FR-AUD-003:** Application users MUST not be able to alter or delete audit history through ordinary application endpoints.
- **FR-AUD-004:** Audit metadata MUST not include passwords, tokens, or unnecessary full sensitive values.
- **FR-AUD-005:** Authorized reviewers MUST be able to search audit events by date, actor, action, and entity.

### 3.11 Settings and administration — P0

- **FR-SET-001:** Authorized administrators MUST manage roles and permissions.
- **FR-SET-002:** The system MUST provide company settings for timezone, currency, work schedule, holidays, and applicable policy defaults.
- **FR-SET-003:** The system MUST support employee and role deactivation without deleting historical transactions.
- **FR-SET-004:** The system SHOULD display service and background-task health to authorized administrators.
- **FR-SET-005:** Changes to permissions and sensitive settings MUST be audited.

### 3.12 Post-release features — P1/P2

- Onboarding/offboarding checklist templates.
- Asset assignment and return tracking.
- Expense and reimbursement workflows.
- Performance reviews and goals.
- Advanced scheduled reports.
- Biometric attendance integration.
- Recruitment and applicant tracking.
- Learning and development.
- AI assistant grounded in approved company policies, with human oversight.

---

## 4. External interface requirements

### 4.1 User interface
- The interface MUST provide role-appropriate navigation and dashboards.
- Forms MUST display validation errors close to the relevant fields.
- Tables MUST support pagination and useful filters.
- Destructive and financial actions MUST require clear confirmation.
- Loading, empty, success, and failure states MUST be designed.
- Important status information MUST not rely on color alone.
- The UI SHOULD follow WCAG 2.2 AA as a target.

### 4.2 API
- APIs MUST be versioned under `/api/v1/`.
- API payloads MUST use JSON unless a file transfer is required.
- Dates MUST use ISO 8601 / `YYYY-MM-DD` formats as appropriate.
- Timestamps MUST include timezone information or use UTC consistently.
- List endpoints MUST paginate.
- APIs MUST return consistent validation and permission errors.
- OpenAPI documentation MUST be generated and kept aligned with the implementation.

### 4.3 File storage
- Uploaded documents MUST be stored in private object storage or a private file system outside the public web root.
- File upload size, extension, MIME type, and content MUST be validated.
- File downloads MUST be authorized server-side.
- Signed download URLs, if used, MUST expire.
- File replacement MUST preserve version history when configured.

### 4.4 Email
Email MAY be used for invitations, password recovery, approvals, and reminders. Email delivery is not the authoritative record of an approval; the database is.

---

## 5. Data model

The following logical tables are recommended. Exact model boundaries can be refined during implementation, but the listed integrity guarantees are mandatory.

### 5.1 Identity and organization
- `users`: email, password hash handled by framework, active status, last login.
- `roles`: role name and description.
- `permissions`: permission codename and description.
- `user_roles`: user-to-role assignments.
- `role_permissions`: role-to-permission mappings.
- `departments`: name, code, active status.
- `positions`: title, department, grade.
- `employees`: user link (optional and unique), employee code, name, joining date, employment status, manager, department, position.
- `employee_contacts`: restricted contact and emergency-contact information.
- `employment_contracts`: contract type, dates, status, document reference.
- `employment_history`: event type, effective date, actor, old/new values.

### 5.2 Attendance and leave
- `work_schedules`: schedule name, timezone, working hours, break policy.
- `schedule_assignments`: employee, schedule, effective-from/to.
- `attendance_records`: employee, work date, check-in/out summary, status.
- `attendance_events`: immutable punch/correction evidence.
- `attendance_corrections`: request, reason, proposed changes, reviewer, decision.
- `leave_types`: name, unit, paid classification, configuration.
- `leave_policies`: eligibility, allocation, accrual, carry-forward, effective dates.
- `leave_requests`: employee, leave type, dates, requested units, status.
- `leave_ledger_entries`: grant, accrual, usage, adjustment, reversal, effective date, reference.
- `leave_balances`: optional derived balance projection; ledger remains authoritative.
- `holidays`: date, name, type.

### 5.3 Payroll
- `salary_structures`: employee, currency, effective dates, status.
- `salary_components`: component code, category, amount, calculation settings.
- `deduction_rules`: versioned calculation configuration and effective dates.
- `payroll_periods`: year, month, start/end dates, status.
- `payroll_runs`: period, run number, state, preparer, approver, lock time.
- `payroll_items`: employee, gross, deductions, net, currency, snapshot.
- `payroll_line_items`: itemized earnings and deductions with calculation snapshot.
- `employee_loans`: principal, outstanding balance, status.
- `loan_installments`: amount, payroll reference, status.
- `payroll_adjustments`: type, amount, reason, approval, period reference.
- `payroll_payments`: amount, method, payment reference, date, status.

### 5.4 Documents, workflow and platform
- `documents`: employee, category, storage key, uploader, expiry.
- `document_versions`: document, version, storage key, checksum.
- `approval_requests`: subject, requester, state, current step.
- `approval_steps`: approver, sequence, decision, comment, timestamp.
- `notifications`: recipient, type, content, read state.
- `audit_logs`: actor, action, entity, timestamp, metadata.
- `company_settings`: key, value, updated by/time.
- `idempotency_records`: idempotency key, operation, response metadata.

### 5.5 Database integrity requirements
- Employee code MUST be unique.
- Email MUST be unique where used for login, using case-insensitive uniqueness.
- A one-to-one employee/user link MUST be unique.
- Payroll period/run and employee payroll item uniqueness MUST prevent accidental duplicate processing.
- Leave approval and ledger updates MUST be atomic.
- Money MUST use decimal database types, not floating-point.
- Foreign-key deletion behavior MUST preserve financial and audit history.
- Effective-dated salary and policy changes MUST not rewrite historical snapshots.
- Indexes SHOULD cover frequently filtered columns such as employee, date, period, and status.
- A generic workflow reference MUST be designed so invalid or orphaned references can be detected or prevented; use concrete foreign keys where integrity is required.

---

## 6. Role-based access control

### 6.1 Default access matrix

| Resource | System admin | HR admin | Payroll/finance | Manager | Employee | Auditor |
|---|---|---|---|---|---|---|
| User accounts and roles | Manage | Limited | No | No | Own security | Read authorized |
| Basic employee records | Limited | Manage | Limited | Assigned team | Own | Read authorized |
| Salary structures | No by default | Explicit grant | Manage | No | No | Read authorized |
| Payroll processing | No by default | Explicit grant | Manage | No | No | Read authorized |
| Own payslips | No by default | Explicit grant | Manage | Own only if employee | Own | Read authorized |
| Attendance | Technical only | Manage | Read if needed | Assigned team | Own | Read authorized |
| Leave policies | No | Manage | No | No | No | Read authorized |
| Leave requests | No | Manage | No | Assigned approvals | Own | Read authorized |
| Documents | Technical only | Authorized scope | Payroll documents | Authorized subset | Own subset | Read authorized |
| Reports | Technical health | HR reports | Payroll reports | Team reports | Own summaries | Read authorized |
| Audit logs | Technical events only | Authorized | Payroll scope | Assigned scope | Own request history | Authorized read |
| Company settings | Technical settings | HR settings | Payroll settings | No | No | Read authorized |

### 6.2 Authorization rules
- Permissions MUST be checked in the backend for every request.
- Record-level access MUST be checked, not just route-level access.
- Managers MUST be limited to employees in their authorized reporting scope.
- Employees MUST not access another employee's records by changing a URL or UUID.
- Salary and bank details MUST have separate permissions from basic profile access.
- Administrative technical access MUST not automatically grant business-data access.
- All permission changes MUST be audited.
- A user assigned multiple roles receives the combined permissions, subject to explicit deny or scope rules if implemented.
- Tests MUST cover privilege escalation and unauthorized object access.

---

## 7. Business workflows and state transitions

### 7.1 Employee onboarding
1. HR creates a draft employee record.
2. System validates required fields and employee code.
3. HR assigns department, position, manager, schedule, and start date.
4. Required documents are collected and recorded.
5. HR invites the employee to create or activate a login.
6. The employee completes permitted onboarding tasks.
7. The record transitions to the appropriate employment state on the effective date.

### 7.2 Attendance correction
1. Employee submits a correction request and reason.
2. System validates the date and current attendance state.
3. The designated manager or HR reviewer examines the request.
4. Reviewer approves or rejects with an audit record.
5. Approved correction adds evidence and recalculates the summary.
6. If the relevant payroll is closed, the system flags an adjustment instead of silently changing finalized payroll.

### 7.3 Leave request
1. Employee selects leave type and date range.
2. System calculates eligible working days/units and checks policy.
3. Request enters Pending.
4. Authorized approver approves or rejects.
5. Approval and leave-ledger posting happen in one transaction.
6. Employee and relevant stakeholders receive notifications.
7. Cancellation/reversal follows a controlled workflow.

### 7.4 Payroll
1. Authorized user creates a payroll period/run.
2. System selects eligible employees and effective salary versions.
3. System collects approved inputs and adjustments.
4. Payroll calculation creates draft line items and snapshots.
5. Validation identifies missing data and anomalous totals.
6. Authorized reviewer approves or returns the run.
7. Approval and locking freeze the payroll snapshot.
8. Payment results are recorded and reconciled.
9. Payslips are published to authorized employees.
10. Corrections use adjustment/reversal records.

### 7.5 Offboarding
1. HR records exit type and effective date.
2. Checklist tasks are assigned.
3. Access revocation is scheduled and confirmed.
4. Assets and handover are checked.
5. Finance reviews final salary, leave, loans, and reimbursements.
6. Final settlement is reviewed and recorded.
7. Applicable employment documents are issued.
8. User access is disabled and employee record archived according to retention policy.

### 7.6 State machines
- **Leave:** Draft → Pending → Approved or Rejected; approved requests may enter Cancellation Pending → Canceled/Restored according to policy.
- **Payroll:** Draft → Calculated → Submitted → Approved → Locked → Paid/Reconciled. Rejected/returned runs may return to Draft with history preserved.
- **Employee:** Draft → Preboarding → Probation/Active → Notice Period → Separated → Archived. Exact states are configurable.
- **Attendance correction:** Pending → Approved or Rejected; later reversals must create a new auditable event.

The backend MUST reject invalid state transitions.

---

## 8. API specification outline

Base path: `/api/v1/`

### 8.1 Authentication
- `POST /auth/login/`
- `POST /auth/logout/`
- `POST /auth/password-reset/`
- `POST /auth/password-reset/confirm/`
- `GET /auth/me/`
- `POST /auth/change-password/`
- Optional: `POST /auth/mfa/setup/`, `POST /auth/mfa/verify/`

### 8.2 Employees and organization
- `GET|POST /employees/`
- `GET|PATCH /employees/{id}/`
- `GET /employees/{id}/history/`
- `POST /employees/{id}/employment-events/`
- `POST /employees/{id}/documents/`
- `POST /employees/import/preview/`
- `POST /employees/import/commit/`
- `GET|POST /departments/`
- `GET|POST /positions/`

### 8.3 Attendance
- `POST /attendance/check-in/`
- `POST /attendance/check-out/`
- `GET /attendance/me/`
- `GET /attendance/`
- `GET /attendance/summary/`
- `GET|POST /attendance/corrections/`
- `POST /attendance/corrections/{id}/approve/`
- `POST /attendance/corrections/{id}/reject/`
- `GET|POST /work-schedules/`
- `POST /schedule-assignments/`

### 8.4 Leave
- `GET /leave/types/`
- `GET /leave/balances/me/`
- `GET /leave/balances/`
- `GET|POST /leave/requests/`
- `GET /leave/requests/{id}/`
- `POST /leave/requests/{id}/approve/`
- `POST /leave/requests/{id}/reject/`
- `POST /leave/requests/{id}/cancel/`
- `GET /leave/calendar/`
- `GET /holidays/`

### 8.5 Payroll
- `GET|POST /salary-structures/`
- `POST /salary-structures/{id}/approve/`
- `GET|POST /payroll/periods/`
- `POST /payroll/runs/`
- `GET /payroll/runs/{id}/`
- `POST /payroll/runs/{id}/calculate/`
- `POST /payroll/runs/{id}/validate/`
- `POST /payroll/runs/{id}/submit/`
- `POST /payroll/runs/{id}/approve/`
- `POST /payroll/runs/{id}/lock/`
- `POST /payroll/runs/{id}/payments/import/`
- `GET /payroll/runs/{id}/reconciliation/`
- `GET /payroll/payslips/me/`
- `GET /payroll/payslips/{id}/download/`

### 8.6 Workflow, files, reporting and settings
- `GET /approvals/inbox/`
- `GET /approvals/{id}/`
- `POST /approvals/{id}/delegate/` (optional)
- `GET /notifications/`
- `POST /notifications/{id}/read/`
- `POST /documents/{id}/download-link/`
- `GET /reports/headcount/`
- `GET /reports/attendance/`
- `GET /reports/leave/`
- `GET /reports/payroll/`
- `GET /audit-logs/`
- `GET|PATCH /settings/`

### 8.7 API requirements
- List endpoints MUST support pagination, appropriate filtering, and safe sorting.
- The server MUST derive the current employee identity from the authenticated user for self-service actions.
- State changes MUST use dedicated actions rather than allowing arbitrary status patches.
- Critical endpoints MUST use transactions and idempotency where appropriate.
- Error responses MUST use a consistent structure with stable error codes.
- Rate limiting MUST protect authentication and sensitive endpoints.
- The generated OpenAPI schema MUST be tested against implemented endpoints.

---

## 9. Non-functional requirements

### 9.1 Security and privacy
- **NFR-SEC-001:** All production traffic MUST use HTTPS.
- **NFR-SEC-002:** Passwords MUST be stored only using a suitable password hashing algorithm provided by the framework.
- **NFR-SEC-003:** Sessions/cookies MUST use secure settings and CSRF protection where applicable.
- **NFR-SEC-004:** Every API endpoint MUST enforce authentication and authorization as required.
- **NFR-SEC-005:** Private documents MUST not be publicly accessible.
- **NFR-SEC-006:** Secrets MUST not be committed to source control.
- **NFR-SEC-007:** Sensitive actions MUST be auditable.
- **NFR-SEC-008:** Uploads MUST be validated and stored safely; malware scanning SHOULD be used where feasible.
- **NFR-SEC-009:** Production personal data MUST not be copied into development/test environments without appropriate safeguards.
- **NFR-SEC-010:** The system MUST have a documented retention and access-review policy.

### 9.2 Performance
- **NFR-PERF-001:** Common API requests SHOULD return within 500 ms at the 95th percentile under the expected workload, excluding slow external services and large exports.
- **NFR-PERF-002:** Employee, attendance, and report lists MUST paginate.
- **NFR-PERF-003:** Reports and exports MUST not block unrelated requests for excessive periods; large jobs SHOULD run asynchronously.
- **NFR-PERF-004:** The system MUST support at least 50 employees with reasonable headroom for growth.

### 9.3 Availability and recovery
- **NFR-OPS-001:** Initial availability target SHOULD be 99.5% monthly, excluding agreed maintenance.
- **NFR-OPS-002:** Database backups MUST be automated.
- **NFR-OPS-003:** Backup restoration MUST be tested and documented.
- **NFR-OPS-004:** Initial recovery time objective SHOULD be four hours.
- **NFR-OPS-005:** Initial recovery point objective SHOULD be 24 hours or better; improve backup frequency if business risk requires it.
- **NFR-OPS-006:** Errors and critical background-job failures MUST be observable to an authorized operator.

### 9.4 Usability and accessibility
- **NFR-UX-001:** Core employee tasks MUST work on mobile screens.
- **NFR-UX-002:** Forms MUST clearly show validation and submission errors.
- **NFR-UX-003:** Status MUST not be communicated by color alone.
- **NFR-UX-004:** The UI SHOULD target WCAG 2.2 AA.
- **NFR-UX-005:** Bangla localization SHOULD be supported without redesigning the data model.

### 9.5 Maintainability
- **NFR-MNT-001:** The backend MUST be organized into domain modules.
- **NFR-MNT-002:** Business rules MUST reside in tested service/domain logic rather than duplicated in API views or frontend components.
- **NFR-MNT-003:** Database schema changes MUST use migrations.
- **NFR-MNT-004:** API documentation MUST be generated from or verified against the implementation.
- **NFR-MNT-005:** Critical calculations and permissions MUST have automated tests.
- **NFR-MNT-006:** Deployment and recovery procedures MUST be documented.

### 9.6 Localization and compliance
- **NFR-LOC-001:** BDT MUST be the default currency.
- **NFR-LOC-002:** `Asia/Dhaka` MUST be the default timezone.
- **NFR-LOC-003:** Dates and timestamps MUST be handled consistently across UI, API, and database.
- **NFR-LOC-004:** Tax and employment policies MUST be configurable and effective-dated.
- **NFR-LOC-005:** Current Bangladesh legal requirements MUST be validated before production payroll use; this SRS does not itself certify legal compliance.

---

## 10. Architecture and deployment

### 10.1 Architecture
Use a modular monolith:
1. **Frontend:** Nuxt/Vue + TypeScript.
2. **Backend:** Django + Django REST Framework.
3. **Database:** PostgreSQL.
4. **Files:** Private object storage.
5. **Background tasks:** Celery + Redis when needed for reminders, scheduled accruals, and exports.
6. **Email:** Configured transactional email provider.
7. **Operations:** HTTPS reverse proxy, application logging, error monitoring, database backup, and restoration procedures.

For an initial small deployment, scheduled Django management commands may replace Celery if reliability and hosting constraints permit. Do not add microservices without a clear operational need.

### 10.2 Suggested backend layout
```text
backend/
  config/
    settings/
    urls.py
    asgi.py
  apps/
    accounts/
    organization/
    employees/
    attendance/
    leave/
    payroll/
    documents/
    workflows/
    notifications/
    reports/
    audit/
  common/
    permissions.py
    exceptions.py
    pagination.py
    validators.py
  tests/
  manage.py
```

### 10.3 Suggested frontend layout
```text
frontend/
  app/
    pages/
      dashboard/
      employees/
      attendance/
      leave/
      payroll/
      documents/
      approvals/
      reports/
      settings/
    components/
    composables/
    layouts/
    middleware/
    types/
  tests/
```

### 10.4 Environments
- Local development.
- Automated test/CI environment.
- Staging with synthetic or anonymized data.
- Production with restricted access and production secrets.

### 10.5 Observability
- Structured application logs.
- Error monitoring and alerts.
- Health checks for application and database connectivity.
- Background-job monitoring if a task queue is used.
- Audit logs separated from ordinary diagnostic logs.
- Alerts for failed backups, failed payroll jobs, and repeated authentication failures.

---

## 11. Testing and acceptance criteria

### 11.1 Test layers
- Unit tests for leave, attendance, and payroll calculations.
- API tests for authentication, permissions, validation, and state transitions.
- Integration tests across attendance, leave, payroll, notifications, and documents.
- Database tests for uniqueness, foreign keys, transactions, and concurrent operations.
- Frontend tests for form states, accessibility, and responsive behavior.
- Playwright end-to-end tests for key employee and HR workflows.
- Security tests for IDOR, privilege escalation, CSRF, malicious uploads, and session handling.
- Backup restoration drills.

### 11.2 Minimum acceptance criteria
The initial release is acceptable only when:
1. HR can create, update, and archive employee records while preserving linked history.
2. A user cannot access another employee's private data by changing an identifier.
3. Attendance events and corrections remain traceable.
4. Leave approval and ledger posting are atomic and produce correct balances.
5. Salary calculations use decimal arithmetic and preserve effective-dated inputs.
6. Payroll cannot be published before required validation and approval.
7. Locked payroll cannot be silently modified.
8. Payslips and documents are available only to authorized users.
9. Reports and exports enforce access permissions.
10. Sensitive changes are recorded in audit logs.
11. Payroll has been compared with independently calculated test cases and approved by the company.
12. A database backup has been restored successfully in a test environment.
13. Production configuration contains no committed secrets.
14. Core workflows have passed automated tests on supported browsers.

### 11.3 Required payroll test cases
- Normal monthly salary.
- New hire joining partway through a period.
- Employee leaving partway through a period.
- Salary increment effective mid-period.
- Approved unpaid leave.
- Bonus and arrears.
- Loan installment.
- Missing or corrected attendance.
- Duplicate payroll submission or retry.
- Rejected payroll and recalculation.
- Locked payroll correction through adjustment.
- Failed or partial payment reconciliation.

Expected results must be approved independently of the implementation, not generated solely by the code being tested.

---

## 12. Implementation roadmap

The following estimate assumes one developer, AI coding assistance, and timely stakeholder feedback. It is a planning estimate, not a guarantee.

### Phase 1 — Foundation (Weeks 1–2)
- Repository and environment setup.
- Database models and migrations.
- Authentication, roles, and permission tests.
- Organization settings, departments, and positions.
- Employee CRUD, profile pages, and audit infrastructure.

**Exit gate:** employee management is functional and unauthorized access tests pass.

### Phase 2 — Attendance and leave (Weeks 3–4)
- Work schedules and holidays.
- Check-in/out and attendance summaries.
- Correction request workflows.
- Leave policies, ledger, balances, and approvals.
- Notifications and basic reports.

**Exit gate:** concurrency, date handling, and leave balance tests pass.

### Phase 3 — Payroll (Weeks 5–7)
- Salary structures and effective dates.
- Payroll calculation and snapshots.
- Validation, approval, locking, and payments.
- Payslips and reconciliation reports.
- Local compliance review and independent calculation checks.

**Exit gate:** payroll scenarios are independently verified; no production payroll is run before approval.

### Phase 4 — Documents and self-service (Weeks 8–9)
- Private document storage and permissions.
- Employee self-service dashboard.
- Profile change requests.
- Payslip/document downloads.
- Expiry reminders and mobile refinements.

**Exit gate:** employee self-service is usable and private records remain isolated.

### Phase 5 — Hardening and launch (Weeks 10–12)
- Data import and migration verification.
- Security and end-to-end tests.
- Backup restoration drill.
- Monitoring and production deployment.
- HR training, operational documentation, and controlled rollout.

**Exit gate:** all mandatory acceptance criteria pass and company stakeholders sign off.

### Post-launch
Prioritize onboarding/offboarding, asset management, expenses, performance reviews, scheduled reports, and integrations according to actual company needs.

---

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Incorrect statutory payroll calculation | Validate rules with qualified local advisers; version rules; test independently |
| Unauthorized salary/document access | Server-side field/object permissions; security tests; access logs |
| Duplicate payroll processing | Unique constraints, transactions, idempotency, controlled state machine |
| Incorrect leave balances | Ledger-based accounting, atomic posting, concurrency tests |
| Historical records overwritten | Effective-dated records and immutable payroll snapshots |
| Data loss | Automated backups, restoration drills, documented RPO/RTO |
| Scope expansion | Keep P1/P2 features out of the initial release unless explicitly approved |
| Dependency on one administrator | Document operations, maintain recovery access, review permissions periodically |
| Notification failures | Commit business state first; retry notifications separately |
| Unclear HR policy | Obtain written decisions for leave, overtime, shifts, payroll cutoffs, and approvals before implementation |

---

## 14. Decisions required before development

The product owner must confirm these decisions before the relevant modules are implemented:

1. Company name, logo, timezone, weekly working days, and official work schedule.
2. Employee ID format and required employee profile fields.
3. Leave types, allocation, accrual, carry-forward, holidays, and approval policy.
4. Attendance rules, grace period, overnight shifts, correction windows, and overtime policy.
5. Salary components, payroll cutoff, proration rules, deduction rules, and payment workflow.
6. Current applicable Bangladesh statutory requirements and who approves the calculation rules.
7. Whether one person can prepare and approve payroll.
8. Which roles may view bank details, salary data, and sensitive documents.
9. Document retention periods and access-revocation timing.
10. Hosting provider, backup frequency, acceptable downtime, and recovery targets.
11. Whether email notifications and MFA are required at launch.
12. Whether Bangla UI is required in version 1 or only later.

Unknown policy decisions MUST be configurable where practical and documented before implementation; developers must not invent employment or payroll policy.

---

## 15. Definition of version 1

Version 1 includes:
- Authentication and role-based access.
- Organization settings and employee management.
- Attendance and correction workflows.
- Leave policies, balances, and approvals.
- Salary structures and controlled monthly payroll.
- Payslips and payment reconciliation.
- Basic private document management.
- Employee self-service.
- Notifications, reporting, and audit logs.
- Deployment, monitoring, backup, recovery, and documentation.

Version 1 does not require recruitment, LMS, AI decision-making, biometric integration, or multi-tenant functionality.

**End of SRS**
