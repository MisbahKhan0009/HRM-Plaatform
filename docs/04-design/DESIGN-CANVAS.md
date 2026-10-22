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
| `Sidebar.dc.html` | shared | Role-aware navigation (employee, manager, hr, payroll), used by every desktop screen | INFORMATION-ARCHITECTURE §3 |

Sample names and amounts are illustrative. Payroll figures follow the business rules: 48,000 × 12/31 = 18,580.65 and 40,000 × 15/31 + 46,000 × 16/31 = 19,354.84 + 23,741.94 = 43,096.78.

## Not yet designed

The remaining screens from `SCREEN-INVENTORY.md` (attendance month and team views, reimbursement claim form, documents, reports, audit log, settings pages, onboarding/offboarding, error and 404 pages) are designed after the owner reviews these core screens, reusing the same shell, tokens and components.
