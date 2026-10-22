# Payroll test cases (v1)

Status: **Draft: requires owner/finance sign-off before go-live.** SRS §11.2 item 11 requires payroll results to be compared with independently calculated cases and approved by the company. This document contains those cases. The expected values were calculated by hand below, not by running the code. Each case must be signed off in §15 before the first production payroll run.

These cases implement SRS §11.3, adapted to the v1 rules. They do not define payroll policy. Where a rule is not yet decided, the case says so and proposes a default that the owner must confirm.

## 1. Rules under test

| Rule | Source |
|---|---|
| One gross monthly amount per employee, effective-dated | D-018 |
| Proration by calendar days: `gross × days_employed_in_period ÷ days_in_month` | D-022, `DOMAIN-MODEL.md` §6 |
| `days_employed_in_period` counts both the joining date and the last working date (inclusive) | Proposed, **confirm with owner** (sign-off item S-01) |
| Leave and attendance never change pay | D-017 |
| No income tax, PF, loans, advances or bonuses | D-019, D-023 |
| Approved reimbursement claims are paid in the next run whose period end ≥ approval date | D-020, `DOMAIN-MODEL.md` §5.5 |
| Manual adjustments: `addition` or `deduction`, each approved | D-019, `DOMAIN-MODEL.md` §5.7 |
| Payments by cash or cheque | D-021 |
| Decimal arithmetic. Each line is computed at full precision, then rounded **half-up to 2 decimals once**. Item totals are sums of rounded lines. | ADR-0006 |
| Locked runs are never edited; corrections go through an adjustment in a later run | FR-PAY-011 |

**Formulas used below**

```text
base_salary line   = round_half_up( gross × days_employed ÷ days_in_month , 2 )
gross_pay          = Σ earning lines            (base_salary, reimbursement, addition, arrears)
total_deductions   = Σ deduction lines          (deduction)
net_pay            = gross_pay − total_deductions
run totals         = Σ over items
```

A full month (`days_employed = days_in_month`) gives exactly `gross`, with no division.

The examples use 2026–2028 dates. Month lengths: Nov 2026 = 30, Dec 2026 = 31, Jan 2027 = 31, Feb 2027 = 28 (not a leap year), Mar 2027 = 31, Feb 2028 = 29 (leap year).

## 2. PAY-01: normal full month

**Inputs:** employee E-A, gross 52,000.00 effective 2025-01-01. Period Nov 2026 (30 days). Employed all month. No claims, no adjustments.

**Calculation:** full month → base_salary = 52,000.00.

**Expected item:**

| Line | Kind | Amount |
|---|---|---|
| base_salary | earning | 52,000.00 |
| **gross_pay** | | **52,000.00** |
| **total_deductions** | | **0.00** |
| **net_pay** | | **52,000.00** |

## 3. PAY-02: new hire joins mid-month

**Inputs:** E-B, gross 45,000.00 effective 2027-02-15. Joining date 2027-02-15. Period Feb 2027 (28 days).

**Calculation:**
1. days_employed = 15 Feb … 28 Feb inclusive = 28 − 15 + 1 = **14**.
2. 45,000.00 × 14 = 630,000.00.
3. 630,000.00 ÷ 28 = 22,500.00 (exact).

**Expected:** base_salary 22,500.00 · gross_pay 22,500.00 · deductions 0.00 · **net_pay 22,500.00**.

## 4. PAY-03: employee leaves mid-month

**Inputs:** E-C, gross 38,500.00. Last working date 2027-03-20, status `separated` effective 2027-03-21. Period Mar 2027 (31 days).

**Calculation:**
1. days_employed = 1 Mar … 20 Mar = **20**.
2. 38,500.00 × 20 = 770,000.00.
3. 770,000.00 ÷ 31 = 24,838.709677…
4. Round half-up to 2 dp: third decimal is 9 → **24,838.71**.

**Expected:** base_salary 24,838.71 · **net_pay 24,838.71**.

Final settlement items beyond prorated salary (leave encashment, notice pay) are not in v1 (D-019) and must be handled outside the system.

## 5. PAY-04: salary change effective mid-period

> **Open owner decision (sign-off item S-02).** The v1 decisions do not say how to pay a salary change that takes effect inside a period. Proposed default: **split-period proration**, where each salary segment is prorated by its own calendar days and each segment is one `base_salary` line. Until the owner confirms, the system must block calculation with a validation error when an effective date falls inside the period (`PAYROLL_MIDPERIOD_SALARY_CHANGE_UNCONFIRMED`), rather than guess.

**Inputs:** E-D. Gross 40,000.00 effective until 2027-01-15; gross 46,000.00 effective from 2027-01-16. Period Jan 2027 (31 days).

**Calculation (proposed split):**
1. Segment 1: 1–15 Jan = 15 days. 40,000.00 × 15 = 600,000.00; ÷ 31 = 19,354.838709… → **19,354.84**.
2. Segment 2: 16–31 Jan = 16 days. 46,000.00 × 16 = 736,000.00; ÷ 31 = 23,741.935483… → **23,741.94**.
3. Sum = 19,354.84 + 23,741.94 = **43,096.78**.

**Expected:**

| Line | Period | Amount |
|---|---|---|
| base_salary | 2027-01-01 → 2027-01-15 @ 40,000.00 | 19,354.84 |
| base_salary | 2027-01-16 → 2027-01-31 @ 46,000.00 | 23,741.94 |
| **net_pay** | | **43,096.78** |

The item snapshot stores both salary structure IDs and both segment day counts (FR-PAY-007).

## 6. PAY-05: approved reimbursements included

**Inputs:** E-E, gross 30,000.00, full month, period Dec 2026 (31 days). Transport claims:

| Claim | Amount | Status | Approved on |
|---|---|---|---|
| RC-1 | 450.00 | approved | 2026-12-10 |
| RC-2 | 1,275.50 | approved | 2026-12-28 |
| RC-3 | 800.00 | approved | 2027-01-02 |
| RC-4 | 300.00 | submitted (not approved) | — |

**Calculation:**
1. base_salary = 30,000.00 (full month).
2. Eligible claims: approved on or before the period end (2026-12-31) → RC-1 and RC-2. RC-3 goes to the January run. RC-4 is not approved.
3. Reimbursement lines: 450.00 + 1,275.50 = 1,725.50.
4. gross_pay = 30,000.00 + 1,725.50 = 31,725.50.

**Expected:** lines base_salary 30,000.00, reimbursement 450.00 (RC-1), reimbursement 1,275.50 (RC-2) · gross_pay 31,725.50 · deductions 0.00 · **net_pay 31,725.50**. RC-1 and RC-2 move to status `included`. RC-3 stays `approved`.

## 7. PAY-06: leave and absences don't change pay

**Inputs:** E-F, gross 36,000.00, full month Nov 2026 (30 days). Five approved casual-leave days, three `absent` days and four `short_hours` days in November.

**Calculation:** leave and attendance are ignored (D-017) → base_salary = 36,000.00.

**Expected:** **net_pay 36,000.00**. No deduction lines exist.

## 8. PAY-07: manual addition and deduction

**Inputs:** E-G, gross 35,000.00, full month Nov 2026. Approved adjustments for Nov 2026: addition 2,000.00 (reason "one-off allowance approved by director"); deduction 1,500.00 (reason "recovery of October overpayment"). A third adjustment, a deduction of 700.00, is still `pending`.

**Calculation:**
1. base_salary 35,000.00.
2. Approved addition +2,000.00. Approved deduction −1,500.00. The pending adjustment is ignored.
3. gross_pay = 35,000.00 + 2,000.00 = 37,000.00.
4. total_deductions = 1,500.00.
5. net_pay = 37,000.00 − 1,500.00 = 35,500.00.

**Expected:** gross_pay 37,000.00 · total_deductions 1,500.00 · **net_pay 35,500.00**. Both approved adjustments move to `applied`.

**Negative net guard:** if deductions exceed gross_pay, validation reports `PAYROLL_NEGATIVE_NET` and the run cannot be submitted (FR-PAY-008).

## 9. PAY-08: duplicate calculate (retry)

**Inputs:** run R-NOV for Nov 2026 with E-A (PAY-01) and E-G (PAY-07). Client sends `POST /payroll/runs/{id}/calculate` with `Idempotency-Key: k-1`, the network drops, and the client resends with the same key. Later a second request uses `Idempotency-Key: k-2`.

**Expected:**
1. Exactly 2 payroll items exist (unique `(payroll_run_id, employee_id)`, FR-PAY-012).
2. The retry with `k-1` returns the stored response; no new rows, audit or outbox entries.
3. The call with `k-2` on a `calculated` run recalculates: items are replaced in one transaction, the values are identical (52,000.00 and 35,500.00), and the run total stays **87,500.00**.
4. Two parallel calculate calls with different keys: one succeeds, the other gets `409` (run row locked).

## 10. PAY-09: returned run and recalculation

**Inputs:** run R-DEC for Dec 2026. E-H's salary structure was entered as gross 55,000.00 instead of 50,000.00 (both effective 2026-12-01). Steps: calculate → submit → approver returns with comment "E-H gross wrong" → payroll officer corrects the salary structure (a new version, effective 2026-12-01, the old one marked superseded) → recalculate → submit → approve.

**Expected:**
1. First calculation: E-H net 55,000.00.
2. After return: run status `returned`, then `draft`. Status history shows `draft → calculated → submitted → returned → draft → calculated → submitted → approved`, each with actor and timestamp.
3. After recalculation: E-H **net_pay 50,000.00**.
4. The first item snapshot is kept in history (not overwritten in place); the audit log has the salary change with old 55,000.00 and new 50,000.00.

## 11. PAY-10: correcting a locked run

**Inputs:** run R-NOV (Nov 2026) is `locked`, with E-I paid at gross 50,000.00. In December, HR finds that E-I's increment to 52,000.00 should have taken effect on 2026-11-01. The December run is calculated with E-I at 52,000.00 (full month Dec).

**Steps:** payroll officer creates a `PayrollAdjustment` of type `addition`, amount 2,000.00, reason "Arrears: November increment", referencing period Nov 2026; it is approved and applied to the December run.

**Calculation (December item):**
1. base_salary 52,000.00 (full month).
2. Arrears addition 52,000.00 − 50,000.00 = **2,000.00** (line code `arrears`).
3. net_pay = 54,000.00.

**Expected:**
- R-NOV is unchanged. Any attempt to edit its items returns `409` with code `PAYROLL_RUN_LOCKED`, and the attempt is audited.
- December item: base_salary 52,000.00, arrears 2,000.00, **net_pay 54,000.00**.

## 12. PAY-11: partial and failed payment reconciliation

**Inputs:** run R-MAR (Mar 2027), `locked`, three items: E-A 52,000.00, E-B 22,500.00, E-C 24,838.71. Run net total = 52,000.00 + 22,500.00 + 24,838.71 = **99,338.71**.

Payments recorded:

| Employee | Method | Reference | Amount | Status |
|---|---|---|---|---|
| E-A | cash | acknowledgment ACK-0311 | 52,000.00 | paid |
| E-B | cheque | 004512 | 22,500.00 | paid |
| E-C | cheque | 004513 | 24,838.71 | failed (bounced) |

**Expected reconciliation:**

| Measure | Value |
|---|---|
| Net payable | 99,338.71 |
| Paid | 52,000.00 + 22,500.00 = 74,500.00 |
| Outstanding | 99,338.71 − 74,500.00 = 24,838.71 |
| Exceptions | E-C: payment failed |

- The run stays `locked` (not `paid`) while any item is unpaid or failed.
- Then E-C is paid in cash, reference ACK-0402, 24,838.71. A new payment row is added; the failed row is kept. Paid becomes 99,338.71, outstanding 0.00, and the run can move to `paid`, then `reconciled` after review.
- A payment whose amount differs from the item's net (e.g. 24,838.00) is rejected with `PAYMENT_AMOUNT_MISMATCH`. v1 does not support split payments; **confirm with owner** (sign-off item S-03).

## 13. PAY-12: rounding edge cases

| ID | Inputs | Hand calculation | Expected base_salary |
|---|---|---|---|
| PAY-12a | gross 33,333.33; joins 2027-01-10; Jan 2027 (31 days) | days = 31 − 10 + 1 = 22. 33,333.33 × 22 = 733,333.26. ÷ 31 = 23,655.911612… → 3rd decimal 1 → down | **23,655.91** |
| PAY-12b | gross 10,000.01; joins 2027-01-31; Jan 2027 | days = 1. 10,000.01 ÷ 31 = 322.580967… → 3rd decimal 0 → down | **322.58** |
| PAY-12c | gross 30,000.15; joins 2026-11-30; Nov 2026 (30 days) | days = 1. 30,000.15 ÷ 30 = 1,000.005 exactly → half-up rounds the 5 up | **1,000.01** (banker's rounding would give 1,000.00: this case catches the wrong mode) |
| PAY-12d | gross 27,500.00; leaves 2027-01-17; Jan 2027 | days = 17. 27,500 × 17 = 467,500. ÷ 31 = 15,080.645161… → 3rd decimal 5, then 1 → up | **15,080.65** |
| PAY-12e | gross 29,000.00; joins 2028-02-15; Feb 2028 (29 days, leap year) | days = 29 − 15 + 1 = 15. 29,000 × 15 = 435,000. ÷ 29 = 15,000.00 exactly | **15,000.00** |

PAY-12c is the most important: it fails if any code path uses binary floating point or `ROUND_HALF_EVEN`.

## 14. PAY-13: validation failures block submission

| ID | Situation | Expected validation result |
|---|---|---|
| PAY-13a | Active employee E-J has no salary structure effective in the period | Calculation completes for others; E-J is listed under `PAYROLL_MISSING_SALARY_STRUCTURE`; `submit` returns `409` until fixed or E-J is explicitly excluded with a reason (audited) |
| PAY-13b | Employee joins after the period end (2027-02-01 for Jan 2027) | Not included; no error |
| PAY-13c | Employee separated before the period start | Not included; no error |
| PAY-13d | Net pay changed by more than 20% from the previous locked run | Warning `PAYROLL_ANOMALY` (does not block); reviewer must acknowledge before approval. The 20% threshold is a proposed setting, **confirm with owner** (sign-off item S-04) |
| PAY-13e | Second `regular` run created for a period that already has one not in `draft`/`returned` | `409 PAYROLL_RUN_EXISTS` |
| PAY-13f | Self-approval by the preparer without a justification note | `422`; with a note it succeeds and sets `self_approved = true` (D-007) |

## 15. Sign-off

Each row is signed by the owner (or the person they name for finance) after checking the hand calculation independently. Payroll must not run in production until all rows are signed (SRS §12 Phase 3 exit gate).

| Item | Decision or case | Signed by | Date |
|---|---|---|---|
| S-01 | Inclusive day counting for joiners and leavers | | |
| S-02 | Mid-period salary change: split-period proration (PAY-04) | | |
| S-03 | No split payments per item in v1 (PAY-11) | | |
| S-04 | Anomaly threshold 20% (PAY-13d) | | |
| PAY-01 … PAY-13 | Expected values above | | |
