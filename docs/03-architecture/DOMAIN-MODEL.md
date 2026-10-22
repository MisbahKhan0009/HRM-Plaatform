# Domain model (canonical)

Status: **Accepted** — 2026-10-22. This is the single source for module names, entities, enums and state machines. Other docs, schemas and code must use these exact names. Changes need a decision-log entry.

Applies SRS v1.0 as modified by decisions D-001…D-040 (`docs/00-requirements/DECISION-LOG.md`).

## 1. Modules (bounded contexts)

| Module | Owns | Notes |
|---|---|---|
| `accounts` | users, sessions, passkeys, TOTP, invitations, role assignments | Better Auth tables + our `user_roles` |
| `organization` | company settings, departments, positions, work schedules, holidays | single company in v1, SaaS-ready (D-001) |
| `employees` | employees, contacts, employment history, contracts, profile change requests | lifecycle distinct from account state (FR-EMP-012) |
| `attendance` | attendance events, daily records, corrections, schedule assignments | flexible core hours (D-010) |
| `leave` | leave types, policies, requests, ledger, balances | ledger is authoritative (FR-LEAVE-008) |
| `payroll` | salary structures, periods, runs, items, line items, adjustments, payments, payslips | single gross amount (D-018) |
| `reimbursements` | transport claims (and future claim categories) | paid through payroll (D-020) |
| `documents` | documents, versions, categories | R2 private storage |
| `approvals` | approval requests, approval steps, inbox | generic workflow, single step in v1 (D-014) |
| `notifications` | outbox, email deliveries, templates | email only (D-025) |
| `reports` | read models and exports | read-only, permission-filtered |
| `audit` | audit log | append-only |
| `settings` | key/value settings with history | technical / HR / payroll scopes |

## 2. Identifiers and common fields

- Primary keys: **UUID v7** (`id`), time-ordered, safe to expose. Human codes are separate: `EMP-0001` (`employee_code`), `PR-2026-11-01` (payroll run number), `LV-000123` (leave request number) — all prefix-configurable.
- Every mutable table: `created_at`, `updated_at` (timestamptz, UTC), `created_by`, `updated_by` (user id, nullable for system jobs), `version` (integer, optimistic locking).
- No hard deletes of business records. Use status (`archived`, `inactive`) or `deleted_at` only where a retention policy allows removal.
- `company_id` column on organization-scoped tables from day one, defaulting to the single company (SaaS-ready, D-001). All repository queries filter by it through one helper.

## 3. Entities (summary)

Full columns, constraints and indexes: `DATA-MODEL.md`.

**Identity:** `User` (email, name, status, preferred theme, locale) · `Role` · `Permission` · `UserRole` · `Session` · `Passkey` · `TwoFactor` · `Invitation`.

**Organization:** `Company` · `Department` · `Position` · `WorkSchedule` (working days, core window, minimum hours) · `Holiday` · `Setting`.

**Employees:** `Employee` (optional unique `user_id`, code, names, status, department, position, manager, joining date) · `EmployeeContact` (restricted) · `EmploymentEvent` (effective-dated history) · `EmploymentContract` · `ProfileChangeRequest`.

**Attendance:** `ScheduleAssignment` (effective from/to) · `AttendanceEvent` (immutable: check_in, check_out, manual, correction) · `AttendanceRecord` (one per employee per work date, derived) · `AttendanceCorrection`.

**Leave:** `LeaveType` · `LeavePolicy` (effective-dated) · `LeaveRequest` · `LeaveLedgerEntry` · `LeaveBalance` (projection).

**Payroll:** `SalaryStructure` (gross, effective_from/to) · `PayrollPeriod` (year, month) · `PayrollRun` · `PayrollItem` (per employee, snapshot) · `PayrollLineItem` · `PayrollAdjustment` · `PayrollPayment` · `Payslip` (publication record).

**Reimbursements:** `ReimbursementClaim` (category `transport`, date, amount, description, receipt document).

**Documents:** `Document` · `DocumentVersion` (R2 key, checksum, size, mime).

**Workflow/platform:** `ApprovalRequest` · `ApprovalStep` · `OutboxMessage` · `EmailDelivery` · `AuditLog` · `IdempotencyRecord`.

## 4. Enums (exact values)

```text
user_status:            invited | active | suspended | deactivated
employee_status:        draft | preboarding | probation | active | notice_period | separated | archived
employment_event_type:  hired | confirmed | promoted | transferred | manager_changed | position_changed |
                        salary_changed | status_changed | separated | rehired
contract_type:          permanent | probation | fixed_term | intern | consultant
attendance_event_type:  check_in | check_out | manual_entry | correction
attendance_source:      web | manual | correction | system
attendance_status:      present | short_hours | missed_core | missing_punch | absent | on_leave |
                        holiday | weekend | not_employed
leave_unit:             day | half_day
half_day_part:          first_half | second_half
leave_ledger_type:      grant | accrual | reservation | reservation_release | usage | adjustment |
                        reversal | carry_forward | expiry
payroll_run_status:     draft | calculated | submitted | returned | approved | locked | paid | reconciled
payroll_line_kind:      earning | deduction
payroll_line_code:      base_salary | proration_adjustment | reimbursement | addition | deduction | arrears
payment_method:         cash | cheque
payment_status:         unpaid | paid | failed | cancelled
adjustment_type:        addition | deduction
approval_subject_type:  leave_request | attendance_correction | reimbursement_claim | profile_change |
                        payroll_run | payroll_adjustment
approval_step_decision: pending | approved | rejected | skipped
outbox_status:          pending | processing | sent | failed | dead
document_category:      identity | contract | certificate | payslip | receipt | policy | other
theme:                  ink | paper
```

## 5. State machines

The backend rejects any transition not listed (FR-WF-009). Every transition writes an `AuditLog` entry; transitions with side effects write an `OutboxMessage` in the same transaction.

### 5.1 User account (`user_status`)
```text
invited ──accept──► active ──suspend──► suspended ──reactivate──► active
   │                  │                     │
   └──revoke──► deactivated ◄──deactivate───┴──────────────────────┘
```
Suspend/deactivate revokes all sessions immediately (FR-AUTH-006).

### 5.2 Employee (`employee_status`)
```text
draft → preboarding → probation → active → notice_period → separated → archived
                    └──────────────► active
active/probation → separated   (immediate separation)
separated → active             (rehire: new employment event, same employee code)
```
`archived` keeps all linked history (FR-EMP-006). Effective-dated transitions are applied by the daily job on their effective date.

### 5.3 Leave request
```text
draft → pending → approved → cancellation_pending → cancelled
          │  └──► rejected          └──► approved (cancellation rejected)
          └──► withdrawn (by requester while pending)
```
Ledger effects: `pending` posts `reservation` (D-016); `approved` posts `reservation_release` + `usage` in one transaction (FR-LEAVE-009); `rejected`/`withdrawn` post `reservation_release`; `cancelled` posts `reversal`. Balance check uses `SELECT … FOR UPDATE` on the employee's balance row (FR-LEAVE-013).

### 5.4 Attendance correction
```text
pending → approved | rejected | withdrawn
```
Approval appends a `correction` `AttendanceEvent` (originals are kept, FR-ATT-008) and recalculates the `AttendanceRecord`. Attendance does not affect pay in v1 (D-017), so no payroll adjustment is triggered.

### 5.5 Reimbursement claim
```text
draft → submitted → approved → included → paid
            └──► rejected     (included = attached to a payroll run; paid = run paid)
submitted → withdrawn
```
An approved claim is picked up by the next payroll run whose period end ≥ approval date. If that run is returned to draft, the claim goes back to `approved`.

### 5.6 Payroll run
```text
draft → calculated → submitted → approved → locked → paid → reconciled
  ▲        │              │
  └────────┴── returned ◄─┘   (returned → draft, history preserved)
calculated → calculated (recalculate, idempotent)
```
- Only one non-`draft`/`returned` run per period with `run_type = regular`; additional runs are `off_cycle` (unique constraint).
- `approved` by the preparer is allowed but sets `self_approved = true` and requires a justification note (D-007).
- `locked`: snapshot frozen; no edits; corrections only through `PayrollAdjustment` in a later run (FR-PAY-011).
- `paid`: every item has a payment record with status `paid`; partial payment keeps the run `locked` and shows exceptions.
- Payslips are published at `locked` or later.

### 5.7 Payroll adjustment
```text
pending → approved → applied (to a run)   |   pending → rejected
```

### 5.8 Profile change request
```text
pending → approved (changes applied + employment event if relevant) | rejected | withdrawn
```

### 5.9 Outbox message
```text
pending → processing → sent
             └──► failed (retry with backoff, max 8) → dead (alert admin)
```

## 6. Core business rules (summary)

Full specifications: `docs/05-backend/BUSINESS-RULES.md`.

- **Work date:** the `Asia/Dhaka` date of the check-in (D-011). A check-out after 23:59 is accepted but flags the record `missing_punch` until HR reviews it.
- **Attendance status** (D-010), evaluated per work date against the assigned schedule: weekend / holiday / on_leave first; then no events → `absent`; check-in without check-out → `missing_punch`; worked minutes < `min_daily_minutes` → `short_hours`; present but not covering the core window → `missed_core`; else `present`. Lateness is reported, never penalised.
- **Leave days:** count working days in the request range by the employee's schedule, excluding holidays; half-day = 0.5. The leave year is the calendar year (D-015).
- **Payroll (v1):** for each eligible employee: `base = gross × days_employed_in_period / days_in_month` (calendar days, D-022), plus approved reimbursements, plus/minus approved adjustments; no tax, PF, loans or bonuses (D-019); leave and attendance do not change pay (D-017). Decimal arithmetic, half-up rounding to 2 places per line (ADR-0006).
- **Self-approval:** forbidden for leave, corrections, claims and profile changes (FR-WF-004); allowed with flag and justification for payroll only (D-007).
