# Information architecture

The app has two zones: an unauthenticated **auth zone** (sign-in, invite acceptance, recovery) and an authenticated **app shell** with a sidebar, top bar and content area. Navigation is built from the user's capabilities returned by `GET /api/v1/auth/me`; a user sees only the groups and items their permissions allow (`docs/03-architecture/SECURITY-MODEL.md`). The route folders match `apps/web/src/routes/(auth)/` and `apps/web/src/routes/_app/` in `docs/03-architecture/MONOREPO.md`.

## 1. Sitemap

```text
(auth)
├── /sign-in                      email entry, passkey button
├── /sign-in/verify               6-digit email code
├── /sign-in/two-factor           TOTP or recovery code (strong session step-up)
├── /accept-invite/$token         first sign-in from an invitation
└── /recover                      can't sign in (recovery options)

_app (authenticated shell)
├── /dashboard                    role-aware home
├── /me                           my profile (own employee record)
│   ├── /me/compensation          my salary structure (compensation.read.own)
│   ├── /me/profile-changes       my profile change requests
│   ├── /me/security              passkeys, authenticator app, recovery codes, sessions
│   └── /me/preferences           theme (Ink/Paper), language
├── /attendance                   my attendance: today, month view, my corrections
│   ├── /attendance/team          team attendance (manager)
│   └── /attendance/records       all records, manual entry (HR)
├── /leave                        my balances and requests
│   ├── /leave/new                new leave request
│   ├── /leave/requests/$requestId
│   ├── /leave/calendar           team or company leave calendar
│   └── /leave/manage             all requests, balances, adjustments (HR)
├── /reimbursements               my claims
│   ├── /reimbursements/new
│   ├── /reimbursements/$claimId
│   └── /reimbursements/manage    all claims (HR, payroll)
├── /payslips                     my payslips
│   └── /payslips/$payslipId
├── /documents                    my documents
├── /approvals                    approval inbox
│   └── /approvals/$approvalId
├── /employees                    directory
│   ├── /employees/new
│   ├── /employees/import
│   └── /employees/$employeeId    tabs: overview, employment, contact, documents,
│                                 attendance, leave, compensation, history
├── /payroll                      payroll runs
│   ├── /payroll/runs/$runId      tabs: items, validation, adjustments, payments,
│   │                             reconciliation, history
│   ├── /payroll/salary-structures
│   └── /payroll/adjustments
├── /reports                      report index
│   ├── /reports/headcount
│   ├── /reports/attendance
│   ├── /reports/leave
│   ├── /reports/payroll
│   └── /reports/reimbursements
├── /audit                        audit log search
└── /settings
    ├── /settings/company         name, logo, timezone, currency, working days
    ├── /settings/departments
    ├── /settings/positions
    ├── /settings/work-schedules
    ├── /settings/holidays
    ├── /settings/leave-types     leave types and effective-dated policies
    ├── /settings/payroll         payroll settings
    ├── /settings/users           invite, suspend, deactivate
    ├── /settings/roles           role assignment and grants
    └── /settings/system          health, background jobs, email delivery status
```

Not found routes render the 404 page (a brand moment, section 6). A route the user may not open renders the same 404 page, matching the API's 404 for out-of-scope records.

## 2. Route map with access

The guard column lists the permission (any one is enough) that the route guard checks before loading. The API checks again on every call.

| Route | Guard (any of) | Notes |
|---|---|---|
| `/dashboard` | signed in | Widgets filtered per permission (section 5) |
| `/me`, `/me/profile-changes` | `employee.read.own` | Hidden for users without a linked employee |
| `/me/compensation` | `compensation.read.own` | |
| `/me/security`, `/me/preferences` | signed in | Available to every user, including `system_admin` without an employee link |
| `/attendance` | `attendance.read.own` | Check-in panel needs `attendance.check_in.own` |
| `/attendance/team` | `attendance.read.team` | |
| `/attendance/records` | `attendance.read.all` | Manual entry needs `attendance.manage` |
| `/leave`, `/leave/new` | `leave.request.own` | |
| `/leave/requests/$requestId` | `leave.request.own`, `leave.read.team`, `leave.read.all` | |
| `/leave/calendar` | `leave.read.team`, `leave.read.all`, `leave.request.own` | Employees see their own entries and public holidays only |
| `/leave/manage` | `leave.read.all` | Adjustments need `leave.balance.adjust` |
| `/reimbursements`, `/reimbursements/new` | `reimbursement.request.own` | |
| `/reimbursements/$claimId` | `reimbursement.request.own`, `reimbursement.review.team`, `reimbursement.read.all` | |
| `/reimbursements/manage` | `reimbursement.read.all` | |
| `/payslips`, `/payslips/$payslipId` | `payslip.read.own`, `payslip.read.all` | |
| `/documents` | `document.read.own` | |
| `/approvals`, `/approvals/$approvalId` | `approval.inbox` | |
| `/employees`, `/employees/$employeeId` | `employee.read.all`, `employee.read.team` | Tabs filtered per permission |
| `/employees/new`, `/employees/import` | `employee.manage` | |
| `/payroll`, `/payroll/runs/$runId` | `payroll.read.all` | |
| `/payroll/salary-structures` | `compensation.read.all` | Edit needs `compensation.manage` |
| `/payroll/adjustments` | `payroll.read.all` | Create needs `payroll.prepare` |
| `/reports` | `report.hr`, `report.payroll`, `report.team` | Report cards filtered per permission |
| `/reports/headcount`, `/reports/attendance`, `/reports/leave` | `report.hr`, `report.team` | `report.team` limits to team scope |
| `/reports/payroll` | `report.payroll` | |
| `/reports/reimbursements` | `report.payroll`, `report.hr` | |
| `/audit` | `audit.read.all`, `audit.read.payroll`, `audit.read.technical` | Results filtered by scope |
| `/settings/company` | `settings.read` | Edit needs `settings.technical.manage` or `settings.hr.manage` per field group |
| `/settings/departments`, `/settings/positions` | `settings.read` | Edit needs `org.manage` |
| `/settings/work-schedules`, `/settings/holidays` | `settings.read` | Edit needs `settings.hr.manage` |
| `/settings/leave-types` | `settings.read`, `leave.policy.manage` | Edit needs `leave.policy.manage` |
| `/settings/payroll` | `settings.read` | Edit needs `settings.payroll.manage` |
| `/settings/users` | `user.manage` | |
| `/settings/roles` | `role.manage` | |
| `/settings/system` | `system.health.read` | |

## 3. Navigation per role

### 3.1 Sidebar groups

The sidebar shows groups in this order. A group with no visible item is hidden. Items show a count badge where noted.

| Group | Item | Route | Shown when the user has | Badge |
|---|---|---|---|---|
| (none) | Dashboard | `/dashboard` | signed in | |
| Me | My attendance | `/attendance` | `attendance.read.own` | |
| Me | My leave | `/leave` | `leave.request.own` | |
| Me | My claims | `/reimbursements` | `reimbursement.request.own` | |
| Me | My payslips | `/payslips` | `payslip.read.own` | |
| Me | My documents | `/documents` | `document.read.own` | |
| Team | Approvals | `/approvals` | `approval.inbox` | pending count |
| Team | Team attendance | `/attendance/team` | `attendance.read.team` | |
| Team | Leave calendar | `/leave/calendar` | `leave.read.team` or `leave.read.all` | |
| People | Employees | `/employees` | `employee.read.all` or `employee.read.team` | |
| People | Attendance records | `/attendance/records` | `attendance.read.all` | |
| People | Leave management | `/leave/manage` | `leave.read.all` | |
| People | Claims | `/reimbursements/manage` | `reimbursement.read.all` | |
| Payroll | Payroll runs | `/payroll` | `payroll.read.all` | |
| Payroll | Salary structures | `/payroll/salary-structures` | `compensation.read.all` | |
| Payroll | Adjustments | `/payroll/adjustments` | `payroll.read.all` | |
| Insights | Reports | `/reports` | any `report.*` | |
| Insights | Audit log | `/audit` | any `audit.read.*` | |
| Admin | Settings | `/settings/company` | `settings.read` | |
| Admin | Users | `/settings/users` | `user.manage` | |
| Admin | Roles | `/settings/roles` | `role.manage` | |
| Admin | System health | `/settings/system` | `system.health.read` | failed jobs count |

Group labels use the mono `label` style in `text-3`. The active item has `accent-tint` background, `text` label and a 2px `accent` bar on the leading edge (inside the item, not a card border).

### 3.2 What each default role sees

| Role (SECURITY-MODEL) | Groups |
|---|---|
| `employee` | Dashboard, Me |
| `manager` (derived, always also `employee`) | Dashboard, Me, Team (Approvals, Team attendance, Leave calendar), People > Employees (team scope), Insights > Reports (team) |
| `hr_admin` | Dashboard, Me, Team > Approvals, Leave calendar, People (all), Payroll > Salary structures (read), Insights, Admin > Settings, Users |
| `payroll_officer` | Dashboard, Me, Team > Approvals, People > Employees, Claims, Payroll (all), Insights (payroll reports, payroll audit), Admin > Settings |
| `director` | Dashboard, Me, Team > Approvals, Leave calendar, People > Employees, Claims, Payroll, Insights, Admin > Settings (read) |
| `auditor` | Dashboard, People (read), Payroll (read), Insights, Admin > Settings (read) |
| `system_admin` | Dashboard, Admin (Settings, Users, Roles, System health), Insights > Audit log (technical), Me > security and preferences only if no employee link |

A user who holds several roles sees the union.

### 3.3 Mobile navigation

Below 768px the sidebar collapses into a drawer opened from the top bar. Users whose only roles are `employee` (and optionally `manager`) also get a **bottom navigation bar** with five fixed items, so daily tasks are one tap away:

| Position | Item | Route |
|---|---|---|
| 1 | Home | `/dashboard` |
| 2 | Attendance (shows a check-in state dot) | `/attendance` |
| 3 | Leave | `/leave` |
| 4 | Approvals (managers) or Payslips (others) | `/approvals` or `/payslips` |
| 5 | More (opens the drawer) | none |

Users with administrative roles do not get the bottom bar; they use the drawer. Bottom bar targets are at least 48 × 48px and respect the device safe-area inset.

## 4. Global elements

### 4.1 Top bar (every authenticated page)

From leading to trailing edge:

1. **Menu button** (below 1024px only): opens the sidebar drawer.
2. **Company logo**: the lockup that matches the theme (`bms-logo-full-dark` on Ink, `bms-logo-full-light` on Paper), at least `logo-min-lockup` (120px) wide; the cube mark below that width. Links to `/dashboard`.
3. **Page title** on mobile only (desktop shows it in the page header).
4. **Approval inbox button** (`approval.inbox`): tray icon with the pending count badge; links to `/approvals`. The count comes from `GET /approvals/inbox` (`page.totalItems`) and refreshes on window focus and every 60 seconds while the tab is visible.
5. **Check-in shortcut** (`attendance.check_in.own`, desktop only): shows "Check in" or "Check out" and today's worked time. Mobile users use the Attendance tab.
6. **Theme toggle**: sun/moon icon button, `aria-label` "Switch to light theme" or "Switch to dark theme". Persists the choice (see `docs/06-frontend/THEMING-AND-TOKENS.md`).
7. **User menu**: avatar with initials; opens a menu with name, email, roles, links to My profile, Security, Preferences, and Sign out.

There is no in-app notification bell in v1 (D-025). Notifications go by email; the approval inbox is a work queue, not a notification centre.

### 4.2 Page header (inside the content area)

Breadcrumb (two levels at most), `h1` page title in the display face, optional status badge (for records with a state), the page's one primary action and up to two secondary actions or a "More" menu. On records with a lifecycle, the header also shows the human code (`EMP-0001`, `LV-000123`, `PR-2026-11-01`) in mono.

### 4.3 Session and strong-auth prompts

When the API returns `MFA_REQUIRED` or `REAUTH_REQUIRED`, a modal step-up dialog opens over the current page and retries the request after success (see USER-FLOWS.md, flow 1.4). The page state is kept.

## 5. Dashboard content per role

The dashboard is one route that composes widgets. Each widget is shown only if the user has its permission. Order top to bottom, left to right on desktop (12-column grid); single column on mobile in the same order.

| # | Widget | Permission | Content | Primary action |
|---|---|---|---|---|
| 1 | Welcome header (brand moment) | signed in | Greeting with name, today's date in `Asia/Dhaka`, DotGrid + Glow background | none |
| 2 | Today's attendance | `attendance.check_in.own` | Check-in status, time in, worked time, core window from schedule | **Check in** or **Check out** (the page's primary action for employees) |
| 3 | My leave balances | `leave.request.own` | One StatBar cell per leave type with available days | Secondary: Request leave |
| 4 | My requests | `leave.request.own`, `reimbursement.request.own`, `attendance.correction.request.own` | Last 5 open requests across leave, corrections, claims, profile changes, with status badges | link: View all |
| 5 | Latest payslip | `payslip.read.own` | Period, net pay, published date | Secondary: View payslip |
| 6 | Approvals waiting | `approval.inbox` | Count by subject type, oldest 5 items | **Review approvals** (primary when widget 2 is absent) |
| 7 | Team today | `attendance.read.team` | Present / on leave / absent / missing punch counts for direct and indirect reports | link: Team attendance |
| 8 | Who is on leave | `leave.read.team` or `leave.read.all` | Next 7 days | link: Leave calendar |
| 9 | People overview | `report.hr` | Headcount, joiners and leavers this month, probation ending in 30 days | link: Headcount report |
| 10 | Expiring documents | `document.read.all` | Documents and contracts expiring in 30 days | link: Employees |
| 11 | Payroll status | `payroll.read.all` | Current period run status badge, next step, totals once calculated | **Open payroll run** (primary for payroll officers) |
| 12 | System health | `system.health.read` | Last job runs, failed outbox messages, Neon and R2 usage against free limits | link: System health |

Rule: if several widgets could carry a primary button, the first in the table keeps the Red Fill and the rest render as secondary.

## 6. Brand moments

Per `docs/02-brand/APP-UI-ADAPTATION.md` section 2, DotGrid and Glow appear only on: the auth zone pages, the dashboard welcome header (widget 1), empty states, and the 404 and error pages. They never sit behind tables, forms, dialogs or reports.

## Owner questions (decided, D-049)

All decided on 2026-10-23 (D-049): the default or v1 behaviour written in each item is the decision.


- Should employees see colleagues' names on the leave calendar, or only their own leave and holidays? The default here is own leave only; SRS FR-LEAVE-011 says "subject to permissions".
- Should the company directory (names, department, position, work email) be visible to all employees? SECURITY-MODEL grants employees `employee.read.own` only, so v1 has no employee-wide directory.
