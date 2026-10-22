# Business rules

Status: **Accepted**, 2026-10-22. Normative. Precise algorithms for attendance, leave, payroll, reimbursements, codes and reporting lines, implemented as pure functions in `packages/domain` and tested from the worked examples below. State machines are in `docs/03-architecture/DOMAIN-MODEL.md` section 5; this document specifies the calculations they trigger.

Values marked **seed default** are configuration, not policy decisions. The owner confirms or changes them before go-live (SRS §14). Nothing in this document is legal advice; Bangladesh labour-law defaults must be verified by a qualified adviser (NFR-LOC-005).

## 1. Time

- The database stores timestamps as UTC `timestamptz`. Business dates (`work_date`, leave dates, payroll periods) are calendar dates in the company timezone, setting `company.timezone`, seed default `Asia/Dhaka` (UTC+6, no daylight saving).
- `packages/domain` exposes `toBusinessDate(instant, tz)` and `businessDayBounds(date, tz)` built on `@date-fns/tz`. Code never calls `new Date().getDate()` or formats dates with the runtime's local timezone (Workers run in UTC).
- "Today" for a rule means `toBusinessDate(now, tz)`.

## 2. Attendance

### 2.1 Work date and punches

1. A check-in at instant `t` belongs to `work_date = toBusinessDate(t)` (D-011).
2. A check-out belongs to the work date of the employee's latest check-in without a check-out, when that check-in is less than 16 hours earlier. Otherwise the request fails with `409 NOT_CHECKED_IN`.
3. A check-out whose business date is later than the check-in's work date (after midnight) is accepted and sets `needs_review = true` on the record.
4. A second check-in on a work date that already has a completed pair is accepted (the employee left and came back). Worked time is the sum of pairs; see 2.2.
5. Check-in and check-out derive the employee from the session (FR-ATT-012) and store IP and user agent as evidence only (D-009).

### 2.2 Effective punches for a day

For one `(employee, work_date)`:

1. If correction or manual-entry events exist, take the latest one by `recorded_at`. Its `check_in_at` and `check_out_at` replace the corresponding web punches; a side it leaves NULL keeps the web value.
2. Otherwise pair web events in time order: each `check_in` pairs with the next `check_out`.
3. `first_in_at` = earliest effective check-in; `last_out_at` = latest effective check-out.
4. `span_minutes` = sum over complete pairs of `(check_out - check_in)` in whole minutes, rounded down.
5. `worked_minutes` = `max(0, span_minutes - break_minutes)` where `break_minutes` comes from the schedule. The break is deducted only when `span_minutes > break_minutes`.

Original events are never changed (FR-ATT-008).

### 2.3 Status

Evaluate in this order; the first match wins.

| # | Condition | Status |
|---|---|---|
| 1 | Date before `joining_date` or after `separation_date`, or employee in `draft`/`preboarding` | `not_employed` |
| 2 | Date is not in the schedule's `working_days` | `weekend` |
| 3 | Date is a company holiday | `holiday` |
| 4 | An approved full-day leave covers the date | `on_leave` |
| 5 | No events | `absent` (only once the day is closed; see 2.4) |
| 6 | A check-in without a matching check-out | `missing_punch` |
| 7 | `worked_minutes < required_minutes` | `short_hours` |
| 8 | Core window not covered: `first_in_at > core_start` or `last_out_at < core_end` (local times) | `missed_core` |
| 9 | Otherwise | `present` |

`required_minutes` = `min_daily_minutes`, or half of it when an approved half-day leave covers the date. With a half-day leave, rule 8 is skipped. Rules 2 and 3 still record any punches (`worked_minutes` is kept) so weekend work is visible.

Reported, never penalised (D-010): `late_minutes = max(0, first_in_local - core_start)` and `early_leave_minutes = max(0, core_end - last_out_local)`.

### 2.4 Daily lifecycle

- The first punch of the day creates the `attendance_records` row with `is_final = false`. Every new event recomputes the row in the same transaction.
- The `attendance.close_day` job (daily dispatcher, 00:05) finalises the previous work date: it creates rows for employed employees without one (status from rules 1 to 5), recomputes all rows and sets `is_final = true`.
- An approved correction recomputes the row and sets `has_correction = true`. Attendance never changes pay in v1 (D-017), so a correction to a date in a locked payroll period needs no adjustment.

### 2.5 Worked example

Schedule: Sun to Thu, core 10:00 to 16:00, `min_daily_minutes` 480, `break_minutes` 60.

| Day | Punches (Asia/Dhaka) | worked | late | Status |
|---|---|---|---|---|
| Sun 2 Nov 2026 | 09:05 in, 18:10 out | 545 - 60 = 485 | 0 | `present` |
| Mon 3 Nov | 10:40 in, 19:00 out | 500 - 60 = 440 | 40 | `short_hours` (rule 7 before 8) |
| Tue 4 Nov | 08:00 in, 15:30 out | 450 - 60 = 390 | 0 | `short_hours` |
| Wed 5 Nov | 09:30 in, no out | 0 | 0 | `missing_punch` |
| Thu 6 Nov | 07:00 in, 17:00 out (but 15:00 to 15:30 gap: out 15:00, in 15:30) | 570 - 60 = 510 | 0 | `present` |
| Fri 7 Nov | none | 0 | 0 | `weekend` |

## 3. Leave quantities

### 3.1 Counting days

For a request `[start_date, end_date]` and unit:

```text
units = 0
for each date d from start_date to end_date:
    schedule = schedule assigned to the employee on d
    if weekday(d) not in schedule.working_days: continue
    if d is a holiday: continue
    units += 1
if unit = half_day: units = 0.5     (start_date = end_date is required, and that date must be a working day)
```

- `units = 0` returns `422 LEAVE_NO_WORKING_DAYS`.
- A request may not span two leave years (calendar years, D-015); the employee submits two requests. The API returns `422 INVALID_DATE`.
- An employee may not have two active requests (`pending`, `approved`, `cancellation_pending`) covering the same date, except a `first_half` and a `second_half` on the same date (`409 OVERLAPPING_LEAVE`).
- Policy limits: `max_consecutive_days` caps `units`; `min_notice_days` requires `start_date - today >= min_notice_days` for requests created by the employee. HR acting on behalf bypasses `min_notice_days` (audited).

### 3.2 Example

Request 30 Dec 2026 (Wed) to 6 Jan 2027: rejected with `INVALID_DATE`, spans two leave years. Request 1 Nov to 9 Nov 2026 with schedule Sun to Thu and no holidays: working days are 1, 2, 3, 4, 5, 8, 9 November, so `units = 7`.

## 4. Leave ledger

The ledger (`leave_ledger_entries`) is authoritative; `leave_balances` is a locked projection updated in the same transaction (FR-LEAVE-008, FR-LEAVE-009).

### 4.1 Posting per transition

| Transition | Entries (signed amounts) | Balance columns |
|---|---|---|
| create (directly `pending`) | `reservation -u` | `reserved += u` |
| `pending` → `withdrawn` or `rejected` | `reservation_release +u` | `reserved -= u` |
| `pending` → `approved` | `reservation_release +u`, `usage -u` | `reserved -= u`, `used += u` |
| `approved` → `cancellation_pending` | none | none |
| `cancellation_pending` → `cancelled` | `reversal +u` (references the `usage` entry) | `used -= u` |
| `cancellation_pending` → `approved` | none | none |
| HR adjustment | `adjustment ±a` with reason | `adjusted ± a` (or `entitled += a` when positive, see below) |
| Accrual / grant / carry-forward | `accrual +a` / `grant +a` / `carry_forward +a` | `entitled += a` |
| Expiry | `expiry -a` | `adjusted -= a` |

Positive adjustments (for example a compensatory grant) add to `adjusted`, negative ones subtract. `available = entitled - used - reserved + adjusted`.

### 4.2 Concurrency

Every posting runs inside one transaction:

1. `SELECT ... FROM leave_balances WHERE employee_id = $1 AND leave_type_id = $2 AND leave_year = $3 FOR UPDATE` (insert the row first with `ON CONFLICT DO NOTHING` if missing).
2. For create: if `available - u < 0` and the policy has `allow_negative_balance = false`, fail with `422 INSUFFICIENT_BALANCE`.
3. Insert ledger entries, update the balance row, update the request status (with `version` check), update the approval step, insert audit and outbox rows.
4. Commit.

Approval does not re-check the balance, because the reservation already holds it. Two simultaneous submissions serialise on the row lock, so the second sees the first reservation (FR-LEAVE-013).

## 5. Accrual, carry-forward and expiry

All postings in this section run in the daily dispatcher (`JOBS-AND-OUTBOX.md`); each job checks its date and records itself in `job_runs` so it posts at most once.

Each leave type has one active `leave_policies` row per date. Parameters are configuration; the seed defaults below follow common Bangladesh Labour Act 2006 practice and are **labelled seed defaults to be verified by the owner and an adviser**.

| Type | `allocation_method` | Seed default parameters |
|---|---|---|
| Casual (CL) | `annual_grant` | 10 days/year, prorated in first year, no carry-forward |
| Sick (SL) | `annual_grant` | 14 days/year, prorated in first year, no carry-forward |
| Annual / earned (AL) | `per_days_worked` | 1 day per 18 days worked, eligible after 365 days of service, `max_balance` 40 |
| Compensatory (COMP) | `manual` | Granted by HR adjustment with reason |

### 5.1 `annual_grant`

- On 1 January (`leave.year_end`), grant `annual_entitlement` to every employee eligible on that date.
- An employee who becomes eligible during the year (joins, or passes `eligibility_after_days`) receives a grant on the eligibility date: `annual_entitlement × remaining_months / 12`, where `remaining_months` counts the eligibility month when the date is on or before the 15th, then **rounded down to the nearest 0.5**. With `prorate_first_year = false` the full entitlement is granted.
- Example: CL 10 days, joins 20 March: remaining months April to December = 9, `10 × 9 / 12 = 7.5`. Joins 10 March: 10 months, `8.33`, rounded down to `8.0`.

### 5.2 `monthly_accrual`

On the 1st of each month (`leave.accrue`, run by the daily dispatcher), post `accrual_per_month` for the previous month to employees eligible on the last day of that month. The entry's `effective_date` is the last day of the previous month, which the unique index uses to prevent double posting.

### 5.3 `per_days_worked`

On the 1st of each month (`leave.accrue`), for each eligible employee:

```text
worked_days_ytd = count of attendance_records in the leave year up to the end of the previous month
                  with status in (present, short_hours, missed_core)
earned_ytd      = floor_to_half(worked_days_ytd / days_worked_per_unit)
already         = sum of accrual entries this leave year
post accrual of (earned_ytd - already) if > 0, capped so that available does not exceed max_balance
```

`floor_to_half(x) = floor(x × 2) / 2`. Example: 180 worked days by 31 August, 18 days per unit: `earned_ytd = 10.0`; with 9.5 already accrued, post `0.5`.

For employees not yet past `eligibility_after_days`, worked days still count, but nothing is posted until the eligibility date; the first posting after eligibility includes the earlier days.

### 5.4 Year end (1 January, `leave.year_end`)

For each employee and leave type, using the previous year's balance after all December postings:

1. `remaining = available` (open reservations in the old year stay reserved in the old year until decided).
2. `carry = min(remaining, max_carry_forward)`; NULL `max_carry_forward` means `carry = 0`.
3. If `remaining - carry > 0`: post `expiry -(remaining - carry)` in the old year, effective 31 December.
4. If `carry > 0`: post `carry_forward +carry` in the new year, effective 1 January.
5. Post the new year's `annual_grant` entries.

When `carry_forward_expiry_months` is set, usage in the new year consumes carried-forward days first. On the expiry date, the daily dispatcher's leave step posts `expiry -max(0, carry - usage_since_1_january)`.

The job runs once per year per company (`job_runs` unique `run_key` = year).

## 6. Payroll calculation (v1)

Rule version string: `payroll-v1.0`, stored on `payroll_runs.calculation_rule_version` and in every snapshot. Any change to this section increments it.

### 6.1 Eligible employees

An employee is included in a regular run for period `[P.start, P.end]` when all hold:

- `joining_date <= P.end`, and `separation_date` is NULL or `>= P.start`;
- status is `probation`, `active`, `notice_period`, or `separated` with `separation_date` inside the period;
- at least one approved salary structure overlaps the employed part of the period.

An employee who meets the first two conditions but has no salary structure gets an item with flag `no_salary_structure` (blocking) so the gap is visible rather than silently skipped.

### 6.2 Days employed

```text
from = max(P.start, joining_date)
to   = min(P.end, separation_date ?? P.end)        -- separation_date is the last employed day, inclusive
days_employed = to - from + 1                      -- calendar days (D-022)
days_in_period = P.end - P.start + 1               -- days in the month
```

Leave and attendance do not change pay (D-017).

### 6.3 Base salary lines

**Single salary structure in the period** (the normal case):

```text
amount = round_half_up(gross × days_employed / days_in_period, 2)
```

One `earning` line, code `base_salary`, label "Base salary", `calculation = { grossAmount, days, daysInPeriod, salaryStructureId }`. Rounding is per line; totals are sums of rounded lines (ADR-0006). Arithmetic uses `decimal.js` with precision 30 and rounding `ROUND_HALF_UP`; JavaScript `number` is never used for money.

**More than one approved salary structure overlaps the employed part of the period** (a mid-period change): the owner decided **split-period proration** (D-041). Setting `payroll.midperiod_salary_change_policy` defaults to `segment_proration`. If an operator clears the setting, `calculate` fails with `422 PAYROLL_MIDPERIOD_SALARY_CHANGE_UNCONFIRMED` rather than guessing.

Policy `segment_proration`: split the employed days by structure and pay each segment `round_half_up(gross_s × days_s / days_in_period, 2)` as its own `base_salary` line labelled with its date range. 

### 6.4 Other lines

| Source | Selection | Line |
|---|---|---|
| Reimbursement claims (D-020, FR-REIM-003) | `status = approved` and `decided_at` date `<= P.end` and not yet included | one `earning` line per claim, code `reimbursement`, label "Transport reimbursement (12 Nov)" |
| Payroll adjustments | `status = approved` and `target_period_id = P` | `earning` (`addition`, `arrears`) or `deduction` (`deduction`) line, label from reason |

`gross_amount = sum(earnings)`, `deduction_amount = sum(deductions)`, `net_amount = gross_amount - deduction_amount`.

### 6.5 Validation flags

`validate` and `calculate` set `payroll_items.validation_flags`. Blocking flags prevent `submit`.

| Flag | Blocking | Condition |
|---|---|---|
| `no_salary_structure` | yes (`PAYROLL_MISSING_SALARY_STRUCTURE`) | 6.1 |
| `negative_net` | yes (`PAYROLL_NEGATIVE_NET`) | `net_amount < 0` |
| `currency_mismatch` | yes (`PAYROLL_CURRENCY_MISMATCH`) | any source not in the run currency |
| `zero_net` | no | `net_amount = 0` |
| `joiner` / `leaver` | no | `days_employed < days_in_period` due to joining / separation |
| `net_change_over_threshold` | no | net differs from the employee's previous regular run by more than setting `payroll.anomaly_threshold_percent` (seed default 20) |
| `large_reimbursement` | no | one claim above setting `reimbursements.review_threshold` |

The run also checks totals: `total_net = sum(item.net_amount)` and the item count equals the eligible count.

### 6.6 Snapshot

Each item stores everything needed to reproduce it without reading mutable tables (FR-PAY-007):

```json
{
  "ruleVersion": "payroll-v1.0",
  "period": { "year": 2026, "month": 11, "start": "2026-11-01", "end": "2026-11-30", "daysInPeriod": 30 },
  "employee": { "id": "...", "code": "EMP-0007", "name": "...", "department": "Engineering", "position": "QA Engineer",
                "joiningDate": "2026-11-12", "separationDate": null },
  "salaryStructures": [ { "id": "...", "grossAmount": "45000.00", "effectiveFrom": "2026-11-12", "effectiveTo": null } ],
  "daysEmployed": 19,
  "lines": [ { "kind": "earning", "code": "base_salary", "label": "Base salary", "amount": "28500.00",
               "calculation": { "grossAmount": "45000.00", "days": 19, "daysInPeriod": 30 } } ],
  "totals": { "gross": "28500.00", "deductions": "0.00", "net": "28500.00", "currency": "BDT" },
  "settings": { "rounding": "half_up_2" }
}
```

### 6.7 Recalculation and idempotency

`calculate` deletes and recreates the run's items and lines inside one transaction, which is allowed only in `draft` or `calculated`. It first releases claims and adjustments previously linked to the run. Repeating it with the same inputs produces identical items. The `Idempotency-Key` prevents a double submit from the UI from running two calculations (FR-PAY-019).

### 6.8 Lock, payment and publication

- `lock` (in one transaction): run `approved` → `locked`; linked claims `approved` → `included` with `payroll_item_id`; linked adjustments → `applied`; `payroll_periods.status = 'closed'` for regular runs.
- Recording payments sets `payroll_items.payment_status`. When all items are `paid`, `mark-paid` moves the run to `paid` and the claims to `paid`.
- `publish-payslips` is allowed at `locked` or later and creates one `payslips` row per item.
- Corrections after lock use a `payroll_adjustment` with `corrects_payroll_item_id`, applied in a later run (FR-PAY-011).

### 6.9 Worked examples

These are calculated by hand from the rules above. Payroll acceptance requires the full case set in `docs/07-quality/PAYROLL-TEST-CASES.md`, approved independently of the code (SRS §11.3).

| Case | Inputs | Calculation | Net |
|---|---|---|---|
| Full month | Gross 45,000; November (30 days) | 45000 × 30/30 | 45,000.00 |
| Joiner | Gross 45,000; joins 12 Nov | 19 days: 45000 × 19/30 | 28,500.00 |
| Leaver, 31-day month | Gross 50,000; last day 10 Dec | 50000 × 10/31 = 16129.032... | 16,129.03 |
| Increment mid-month (D-041) | 40,000 to 14 Nov, 46,000 from 15 Nov | `segment_proration`: 40000 × 14/30 = 18,666.67 and 46000 × 16/30 = 24,533.33 | 43,200.00 |
| Reimbursement + deduction | Full month 30,000; approved transport claims 650.00 and 1,200.00; approved deduction adjustment 500.00 | 30000 + 650 + 1200 - 500 | 31,350.00 |

## 7. Reporting lines

### 7.1 Cycle detection (FR-ORG-005)

Before saving `manager_id = M` for employee `E` (`E <> M` is also a check constraint):

```sql
WITH RECURSIVE chain AS (
  SELECT id, manager_id, 1 AS depth FROM employees WHERE id = :M
  UNION ALL
  SELECT e.id, e.manager_id, c.depth + 1 FROM employees e JOIN chain c ON e.id = c.manager_id
  WHERE c.depth < 50
)
SELECT 1 FROM chain WHERE id = :E LIMIT 1;
```

A row means the change creates a cycle: `409 REPORTING_CYCLE`. `E = M` returns `409 SELF_MANAGER` before the query runs.

### 7.2 Team scope

`team` (SECURITY-MODEL section 3) is the recursive set of direct and indirect reports of the user's employee, depth limit 50, excluding the user. The policy layer computes it once per request with a recursive CTE and passes the id list to repositories. At 50 employees this costs one small query.

### 7.3 Approver resolution (D-014)

For leave, attendance corrections and reimbursement claims: the approver is the requester's current `manager_id`'s linked user. If there is no manager, the manager has no active user, or the manager is the requester, the step is assigned to permission `leave.request.review.all` (or the matching `.review.all` permission). A manager change while a request is pending re-assigns its pending step (DATA-MODEL section 10).

## 8. Human-readable codes

| Code | Format | Seed default | Setting |
|---|---|---|---|
| Employee | prefix + zero-padded number | `EMP-0001` | `employees.code_prefix` (`EMP-`), `employees.code_padding` (4) |
| Leave request | `LV-` + 6 digits | `LV-000123` | fixed |
| Reimbursement claim | `RC-` + 6 digits | `RC-000045` | fixed |
| Payroll run | `PR-YYYY-MM-NN` | `PR-2026-11-01` | fixed; `NN` = run sequence within the period |

Generation: in the creating transaction, `UPDATE code_sequences SET next_value = next_value + 1 WHERE company_id = $1 AND scope = $2 RETURNING next_value - 1`. The row lock makes codes gap-free under concurrency, except when the transaction rolls back (the number is then reused, which is acceptable). Padding grows naturally past 9999 (`EMP-10000`). Imported employees may keep existing codes; the sequence is then set above the highest imported number.

## 9. Settings catalogue

Stored in `settings` (DATA-MODEL section 1). Changing a key needs `settings.<scope>.manage` and is audited.

| Key | Scope | Type | Seed default | Used by |
|---|---|---|---|---|
| `company.timezone` | technical | IANA name | `Asia/Dhaka` | all date logic |
| `company.currency` | payroll | ISO 4217 | `BDT` | payroll |
| `company.locale_default` | hr | `en` / `bn` | `en` | new users |
| `employees.code_prefix` | hr | string | `EMP-` | section 8 |
| `employees.code_padding` | hr | int | 4 | section 8 |
| `employees.required_fields` | hr | string[] | `["firstName","lastName","joiningDate","departmentId","positionId"]` | employee validation |
| `attendance.checkout_window_hours` | hr | int | 16 | 2.1 |
| `attendance.correction_window_days` | hr | int | 7 | corrections older than this are rejected |
| `leave.calendar.visible_to_team` | hr | bool | false (D-042) | team calendar for employees (FR-LEAVE-011) |
| `approvals.hide_reviewer` | hr | bool | false | FR-ESS-007 |
| `payroll.anomaly_threshold_percent` | payroll | int | 20 | 6.5 |
| `payroll.allow_self_approval` | payroll | bool | true | D-007 |
| `payroll.midperiod_salary_change_policy` | payroll | `null` or `segment_proration` | `segment_proration` (D-041); null blocks | 6.3 |
| `reimbursements.review_threshold` | payroll | money string | `"5000.00"` | 6.5 |
| `reimbursements.max_claim_age_days` | payroll | int | 60 | claims older than this are rejected at submit |
| `documents.max_upload_mb` | technical | int | 10 | uploads (ADR-0009) |
| `documents.retention_days.<category>` | hr | int or null | null (keep) | retention job (X-003) |
| `security.session_idle_hours` | technical | int | 8 | auth |
| `security.privileged_idle_hours` | technical | int | 1 | auth |

## Open questions (owner)

1. Leave seed defaults in section 5 (entitlements, eligibility, carry-forward, maximum balance) need owner and adviser confirmation.
2. Is `separation_date` the last day worked (paid, inclusive) as assumed in 6.2?
3. Correction window: how many days back may an employee request an attendance correction? Seed default 7.
4. Should weekend or holiday work earn compensatory leave automatically? v1 assumes no: HR grants it manually.
5. Does a transport claim need a receipt above some amount? v1 makes the receipt optional at every amount.
6. Should approved but unpaid reimbursement claims of a separated employee be paid in an off-cycle run? v1 includes them in the final regular run only if approved before it is calculated.
7. ~~Mid-month salary change~~: decided, split-period proration (D-041).
8. On rehire, does `joining_date` reset to the rehire date, or keep the first joining date for length of service? v1 resets it (the old dates stay in the `rehired` employment event), so payroll does not pay the gap between separation and rehire.
9. Should the CSV import create existing staff directly as `probation` or `active` with their historical joining date? v1 creates every imported employee in `draft`, the same as `POST /employees`; HR then runs the lifecycle actions.
10. Does the status become `separated` on the last employed day (`separation_date`) or on the day after? v1 applies it on `separation_date`; payroll uses the dates (6.1, 6.2), and login access ends the day after.
