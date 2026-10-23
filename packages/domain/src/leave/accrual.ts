import { addDays, type IsoDate } from '../dates';
import { Decimal, type DecimalValue } from '../money';

/** BUSINESS-RULES 5.3: `floor_to_half(x) = floor(x × 2) / 2`. */
export function floorToHalf(value: DecimalValue): Decimal {
  return new Decimal(value).times(2).floor().div(2);
}

/** The date an employee becomes eligible under a policy: joining date plus `eligibility_after_days`. */
export function eligibilityDate(joiningDate: IsoDate, eligibilityAfterDays: number): IsoDate {
  return addDays(joiningDate, eligibilityAfterDays);
}

export interface EligibilityInput {
  status: string;
  joiningDate: IsoDate | null;
  separationDate: IsoDate | null;
  eligibleStatuses: readonly string[];
  eligibilityAfterDays: number;
}

/** BUSINESS-RULES 5.1: eligible on `date` when employed, in an eligible status and past the waiting period. */
export function isEligibleOn(e: EligibilityInput, date: IsoDate): boolean {
  if (!e.joiningDate || !e.eligibleStatuses.includes(e.status)) return false;
  if (e.separationDate !== null && e.separationDate < date) return false;
  return eligibilityDate(e.joiningDate, e.eligibilityAfterDays) <= date;
}

/**
 * BUSINESS-RULES 5.1: months left in the leave year from an eligibility date. The eligibility month counts when the
 * date is on or before the 15th.
 */
export function remainingMonths(eligibleOn: IsoDate): number {
  const month = Number(eligibleOn.slice(5, 7));
  const day = Number(eligibleOn.slice(8, 10));
  return 12 - month + (day <= 15 ? 1 : 0);
}

/**
 * BUSINESS-RULES 5.1: the first `annual_grant` of an employee who becomes eligible during the year:
 * `annual_entitlement × remaining_months / 12` rounded down to 0.5, or the full entitlement when the policy does not
 * prorate the first year.
 */
export function proratedAnnualGrant(
  annualEntitlement: DecimalValue,
  eligibleOn: IsoDate,
  prorateFirstYear: boolean,
): Decimal {
  const full = new Decimal(annualEntitlement);
  if (!prorateFirstYear) return full;
  return floorToHalf(full.times(remainingMonths(eligibleOn)).div(12));
}

/** Caps a posting so that `available` does not exceed `maxBalance` (NULL = no cap). Never negative. */
export function capToMaxBalance(
  amount: DecimalValue,
  available: DecimalValue,
  maxBalance: DecimalValue | null,
): Decimal {
  const a = new Decimal(amount);
  if (maxBalance === null) return Decimal.max(a, 0);
  const room = Decimal.max(new Decimal(maxBalance).minus(available), 0);
  return Decimal.max(Decimal.min(a, room), 0);
}

export interface PerDaysWorkedInput {
  /** Attendance records this leave year up to the end of the previous month with status present, short_hours or missed_core. */
  workedDaysYtd: number;
  daysWorkedPerUnit: DecimalValue;
  /** Sum of `accrual` entries already posted this leave year. */
  alreadyAccrued: DecimalValue;
  available: DecimalValue;
  maxBalance: DecimalValue | null;
}

/**
 * BUSINESS-RULES 5.3: `earned_ytd = floor_to_half(worked_days_ytd / days_worked_per_unit)`; post
 * `earned_ytd - already` when positive, capped so that `available` does not exceed `max_balance`.
 */
export function perDaysWorkedAccrual(input: PerDaysWorkedInput): Decimal {
  const earned = floorToHalf(new Decimal(input.workedDaysYtd).div(input.daysWorkedPerUnit));
  return capToMaxBalance(earned.minus(input.alreadyAccrued), input.available, input.maxBalance);
}

/**
 * BUSINESS-RULES 5.2: `accrual_per_month` for the previous month, capped by `max_balance` like every accrual
 * (BUSINESS-RULES open question 8).
 */
export function monthlyAccrual(
  accrualPerMonth: DecimalValue,
  available: DecimalValue,
  maxBalance: DecimalValue | null,
): Decimal {
  return capToMaxBalance(accrualPerMonth, available, maxBalance);
}

/**
 * BUSINESS-RULES 5.4 steps 1–4: of the old year's `available`, carry `min(remaining, max_carry_forward)` (NULL means
 * none) and expire the rest. Nothing moves when `available` is zero or negative.
 */
export function yearEndCarry(
  available: DecimalValue,
  maxCarryForward: DecimalValue | null,
): { carry: Decimal; expiry: Decimal } {
  const remaining = new Decimal(available);
  if (remaining.lte(0)) return { carry: new Decimal(0), expiry: new Decimal(0) };
  const carry = Decimal.min(remaining, maxCarryForward === null ? 0 : maxCarryForward);
  return { carry, expiry: remaining.minus(carry) };
}

/**
 * BUSINESS-RULES 5.4: on the carry-forward expiry date, expire `max(0, carry - usage_since_1_january)`; usage
 * consumes carried days first. Never more than what is still available.
 */
export function carryForwardExpiry(
  carry: DecimalValue,
  usedSinceJanuary: DecimalValue,
  available: DecimalValue,
): Decimal {
  const unused = Decimal.max(new Decimal(carry).minus(usedSinceJanuary), 0);
  return Decimal.max(Decimal.min(unused, available), 0);
}

/**
 * The date carried-forward days of `leaveYear` expire: `carry_forward_expiry_months` after 1 January. Returns null
 * when that falls outside the leave year, where the next year end governs instead (BUSINESS-RULES open question 9).
 */
export function carryForwardExpiryDate(leaveYear: number, months: number): IsoDate | null {
  if (months < 1 || months > 11) return null;
  return `${leaveYear}-${String(months + 1).padStart(2, '0')}-01`;
}
