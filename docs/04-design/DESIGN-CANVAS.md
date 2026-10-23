# Design canvas (Stage 6)

**Live canvas:** https://claude.ai/artifact/GTYJdyZco9r61pJYCVtqKF. It is a Claude Design artifact and private to the owner until shared from its Share menu.

The canvas uses the owner's **Big-Matrix Solutions** design system (installed on the canvas as `ds/bigmatrix`: tokens, fonts and the real `BigMatrix` components Button, Eyebrow, StatBar, Card, Tick, DotGrid and Glow). App-only styles (themes, badges, tables, forms, shell) are in `hrm-app.css`, which implements `docs/02-brand/APP-UI-ADAPTATION.md` and `COMPONENT-SPECS.md`. Every desktop and mobile screen has a **Theme** tweak (Ink default, Paper).

A source snapshot is kept in `canvas/` so developers can read the markup without opening the canvas. **The canvas is the source of truth**: re-copy the snapshot after design changes.

| Artboard | Role | Shows | Specs |
|---|---|---|---|
| `Main.dc.html` Sign in | everyone | Passwordless sign-in (email code + passkey); brand moment with dot grid and glow | USER-FLOWS sign-in, D-033 |
| `Dashboard.dc.html` | employee | Welcome header (brand moment), check-in, leave StatBar, this week, my requests, latest payslip, holidays | SCREEN-INVENTORY dashboard |
| `MobileHome.dc.html` | employee, phone | Checked-in state, core-hours meter, check-out, balances, missing-punch alert, tab bar | D-010, mobile nav |
| `MobileLeave.dc.html` | employee, phone | Leave request: type, full or half day, Sun-first calendar with weekends, working-day count, balance after | D-015, D-016 |
| `Approvals.dc.html` | manager | Inbox list + detail, overdue flag, team overlap warning, reject requires comment, history | D-014, FR-WF-001…005 |
| `Leave.dc.html` | employee | Balances per type, request table with withdraw/cancel | FR-LEAVE-003/010 |
| `Employees.dc.html` | HR | Headcount StatBar, search, filter chips, table, pagination, import/export | FR-EMP-007/008 |
| `PayrollRun.dc.html` | payroll officer | 7-step lifecycle, totals, validation (warning + notes), items with split-period proration and joiner proration | D-018…D-022, D-041 |
| `Payslip.dc.html` | employee (print, Paper) | Itemised payslip: base salary, transport reimbursement, net pay, cheque details | FR-PAY-013, D-021, D-037 |
| `EmployeeProfile.dc.html` | HR | Header, tabs, employment, sign-in account (reset/suspend), documents (restricted, expiring), effective-dated history | FR-EMP-003/005, FR-DOC |
| `DashboardPaper.dc.html` | — | The employee dashboard in Paper (light) mode | D-040 |
| `UIKit.dc.html` | — | Buttons, fields (hint and error), select, segmented, all badge tones, alerts, table, StatBar, empty state; Ink and Paper side by side | COMPONENT-SPECS |
| `VerifyCode.dc.html` | everyone | Email code entry with wrong-code error, resend countdown | SCREEN-INVENTORY 1.2 |
| `TwoFactor.dc.html` | privileged roles | Authenticator step-up, passkey alternative, recovery code | 1.3, D-006, D-033 |
| `NotFound.dc.html` | everyone | 404 / no access brand moment with request ID | §0 standard states |
| `AttendanceMe.dc.html` | employee | Today panel, month calendar with a word per day, correction request for a missing punch | 3.1, FR-ATT-006/008 |
| `ClaimNew.dc.html` | employee | Transport claim form with receipt upload, recent claims and their statuses | 5.1–5.2, FR-REIM |
| `Documents.dc.html` | employee | Own documents, expiring certificate, note that identity documents stay with HR | 6.3 |
| `Security.dc.html` | payroll officer | Passkeys, authenticator app, recovery codes, sessions, theme and language preferences | 2.5–2.6, D-040 |
| `AttendanceTeam.dc.html` | manager | Day view for direct reports with summary StatBar | 3.2 |
| `EmployeeNew.dc.html` | HR | Sectioned onboarding form: employment details, starting status, invite toggle | 8.2, SRS 7.1 |
| `Offboarding.dc.html` | HR | Separation details, checklist, final settlement preview (15/30 days) | SRS 7.5 |
| `PayrollRuns.dc.html` | payroll officer | Run list with statuses, off-cycle run, self-approved flag | 9.1 |
| `PayrollApprove.dc.html` | payroll officer | Approval dialog for a self-prepared run with a required reason | D-007, FR-PAY-020 |
| `PayrollPayments.dc.html` | payroll officer | Locked run, reconciliation StatBar, payments table, record cash/cheque payment (no split payments) | D-021, D-042, FR-PAY-014/015 |
| `SalaryStructures.dc.html` | payroll officer | Gross per employee, effective-dated history, mid-month change note | 9.3, D-018, D-041 |
| `Reports.dc.html` | HR | Attendance report with filters, StatBar, bar chart, export | 10.2 |
| `Audit.dc.html` | HR | Audit search with before/after drawer for a salary change | 10.3, FR-AUD-005 |
| `SettingsSchedules.dc.html` | HR | Work schedule editor (Sun–Thu, core hours, minimum), versions list | §11, D-005, D-010 |
| `SettingsUsers.dc.html` | system admin | Users, strong sign-in status, role assignment with re-auth | §11, SECURITY-MODEL |
| `SystemHealth.dc.html` | system admin | Email failure alert, outbox counts, job runs, backup status, free-tier usage meters | §11, ADR-0009 |
| `SettingsNav.dc.html` | shared | Settings sub-navigation used by the settings pages | §11 |
| `Sidebar.dc.html` | shared | Role-aware navigation (employee, manager, hr, payroll, admin), used by every desktop screen | INFORMATION-ARCHITECTURE §3 |

Sample names and amounts are illustrative. Payroll figures follow the business rules: 48,000 × 12/31 = 18,580.65 and 40,000 × 15/31 + 46,000 × 16/31 = 19,354.84 + 23,741.94 = 43,096.78.

## Coverage

All 33 artboards cover every role and the key flows from `USER-FLOWS.md`. Screens not drawn separately reuse a drawn pattern:

| Screen | Reuses |
|---|---|
| Accept invitation, Can't sign in | `VerifyCode` card layout |
| Leave request detail, claim detail, approval detail | `Approvals` detail panel |
| Leave calendar, leave management | `AttendanceMe` calendar, `Employees` table |
| Attendance records, claims management, payroll adjustments | `Employees` table + filters |
| Import employees | `EmployeeNew` sections + `ClaimNew` upload |
| Other report pages | `Reports` |
| Company, departments, positions, holidays, leave types, payroll settings | `SettingsSchedules` (form + versions) |
| My payslips list, my profile, profile changes | `Leave` table, `EmployeeProfile` cards |
