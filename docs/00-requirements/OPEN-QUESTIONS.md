# Open questions for the owner

**Status 2026-10-22: all proposed defaults ACCEPTED by the owner (D-041…D-043); D3 answered "public" instead of the default.** Still needed from the owner before go-live: C5 retention periods, A7 the named payroll sign-off person, B8 the holiday list, C9 the import data.

Collected from all Stage 5 documents on 2026-10-22. Each has a **proposed default**. Accepted answers move to `DECISION-LOG.md` and this list is updated. Items marked **(before build)** block implementation of that feature; the rest can be answered any time before go-live.

## A. Payroll
| # | Question | Proposed default | Source |
|---|---|---|---|
| A1 | How is a salary change that takes effect mid-month paid? **(before build)** | Split-period proration: old gross for days before the change, new gross from the change date, both by calendar days | BUSINESS-RULES §6.3, PAYROLL-TEST-CASES |
| A2 | Is the separation date the last paid day (inclusive)? Are join and separation days both counted? | Yes, both inclusive | BUSINESS-RULES §6.2 |
| A3 | May one payroll item be paid in parts (e.g. half cash, half cheque)? | No: one payment record per item; a failed payment is cancelled and re-recorded | PAYROLL-TEST-CASES S-03, USER-STORIES US-PAY-007 |
| A4 | Warning threshold for month-on-month net pay change | 20% | USER-FLOWS, US-PAY-004 |
| A5 | Separated employee's approved but unpaid claims | Paid in the final regular run if approved before it is calculated; otherwise an off-cycle run | BUSINESS-RULES Q6 |
| A6 | Payslip header fields | Company name and logo, employee name, code, department, position, period, payment method and date; no bank details | SCREEN-INVENTORY |
| A7 | Who signs off the payroll rules and the independent test results? | Owner names a person before Stage 9 | SCOPE-V1, PAYROLL-TEST-CASES §15 |

## B. Leave and attendance
| # | Question | Proposed default | Source |
|---|---|---|---|
| B1 | Allocation, eligibility, carry-forward and expiry per leave type **(before build)** | Seed values: Casual 10/yr (no carry-forward), Sick 14/yr (no carry-forward), Annual/Earned 1 day per 18 worked (carry-forward up to the legal maximum), Compensatory granted by HR. Confirm with an adviser | BUSINESS-RULES §5 |
| B2 | Default core-hours window and minimum daily hours **(before build)** | Core 10:00–16:00, minimum 8 h | SCOPE-V1 |
| B3 | How many days back can an attendance correction be requested? | 7 days | BUSINESS-RULES Q3 |
| B4 | Can approved leave be cancelled after it has started? | No, only up to and including the start date | USER-FLOWS |
| B5 | Does weekend/holiday work earn compensatory leave automatically? | No, HR grants it manually | BUSINESS-RULES Q4 |
| B6 | Can employees see colleagues' leave on the calendar? | Off by default (setting `leave.calendar.visible_to_team`); names and dates only when on | SECURITY-MODEL, IA |
| B7 | Do managers see their reports' worked hours or only the status? | Hours and status | SCREEN-INVENTORY |
| B8 | First-year holiday list | HR enters the official 2027 Bangladesh holiday list before go-live | SCOPE-V1 |

## C. Employees, documents and access
| # | Question | Proposed default | Source |
|---|---|---|---|
| C1 | Required fields when creating an employee | Name, work or personal email, joining date, department, position; everything else optional | DATA-MODEL Q1 |
| C2 | Collect gender? | Optional field, can be hidden | DATA-MODEL Q2 |
| C3 | Is there a company directory for all employees (name, department, position, work email)? | No in v1 | IA |
| C4 | Can employees download their own identity documents (NID scans)? | No, HR only | USER-FLOWS |
| C5 | Document retention period per category | Owner must supply before go-live (legal advice) | X-003 |
| C6 | Expiry reminder window for documents and contracts | 30 days before | USER-STORIES |
| C7 | Exit types for offboarding | Resignation, termination, end of contract, retirement, other | USER-FLOWS |
| C8 | Transport claim receipt required above an amount? | Optional at every amount | BUSINESS-RULES Q5 |
| C9 | Will existing employee data be imported from a spreadsheet? Who prepares it? | Yes, via CSV import; HR prepares | SCOPE-V1 |
| C10 | May an `hr_admin` (`user.manage` without `role.manage`) grant roles when inviting a user? | No: `roleCodes` at invitation also needs `role.manage`, so `user.manage` alone cannot create a more privileged account; HR invites, a system admin assigns roles | API-CATALOGUE §2 |
| C11 | May `role.manage` grant privileged permissions (payroll, compensation, audit) to roles without strong auth, such as the derived `employee` and `manager` roles? | **Decided: no.** A role without strong auth may hold only the default manager and employee grants; the API refuses others (`422 needs_strong_auth`) | API-CATALOGUE §2 |
| C12 | Does `audit.read.technical` see the metadata of security events (role grants, invitations, resets)? | No: actor and action only; metadata of technical events only | AUDIT §5 |
| C13 | May an `hr_admin` (`user.manage`) suspend a `system_admin` or reset their sign-in factors? | **Decided (D-048): no.** Account actions on a `system_admin` need `role.manage`; a system admin can act on HR admins | SECURITY-MODEL §4 |

## D. UI and operations
| # | Question | Proposed default | Source |
|---|---|---|---|
| D1 | Time format | 12-hour (`9:12 am`) | CONTENT-STYLE |
| D2 | Overdue threshold for pending approvals | 3 working days | COMPONENT-SPECS |
| D3 | GitHub repo public or private? Free branch protection and deployment approvals exist only for public repos | Private, with the manual-dispatch production guard in CI-CD §4 | ACCOUNT-SETUP §7.2, CI-CD §4 |
| D4 | Backup of uploaded documents (R2) | Weekly encrypted copy to the dedicated Gmail account's Google Drive (free 15 GB) via a GitHub Action | BACKUP-AND-RESTORE §1 |
| D5 | Worker (app) name, fixed forever because passkeys are bound to it | `hrm` → `hrm.<account>.workers.dev` | ENVIRONMENTS |
| D6 | When Bangla ships: Bangla or Latin digits; bilingual payslips? | Decide when Bangla is scheduled | I18N |
