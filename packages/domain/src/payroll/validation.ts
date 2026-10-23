import type { PayrollFlag } from '@hrm/contracts';
import type { IsoDate } from '../dates';
import { Decimal } from '../money';

/**
 * Blocking flags and their submit error codes, in the order API-STANDARDS §7 "Payroll blocking codes" picks the
 * top-level code.
 */
export const BLOCKING_FLAGS = [
  ['no_salary_structure', 'PAYROLL_MISSING_SALARY_STRUCTURE'],
  ['negative_net', 'PAYROLL_NEGATIVE_NET'],
  ['currency_mismatch', 'PAYROLL_CURRENCY_MISMATCH'],
] as const;

export type BlockingCode = (typeof BLOCKING_FLAGS)[number][1];

export const isBlockingFlag = (flag: PayrollFlag) => BLOCKING_FLAGS.some(([f]) => f === flag);

export interface FlagInput {
  period: { start: IsoDate; end: IsoDate };
  joiningDate: IsoDate;
  separationDate: IsoDate | null;
  daysEmployed: number;
  daysInPeriod: number;
  missingSalaryStructure: boolean;
  net: string;
  runCurrency: string;
  /** Currencies of every source (salary structures, claims, the item). */
  sourceCurrencies: readonly string[];
  /** Net of the employee's item in the previous locked regular run, or null when there is none. */
  previousNet: string | null;
  anomalyThresholdPercent: number;
  reimbursementAmounts: readonly string[];
  reimbursementReviewThreshold: string;
  /**
   * `off_cycle` items pay only claims and adjustments (BUSINESS-RULES 6.10), so `no_salary_structure`, `joiner`,
   * `leaver` and `net_change_over_threshold` do not apply. Omitted means `regular`.
   */
  runType?: 'regular' | 'off_cycle';
}

/**
 * Validation flags of one item (BUSINESS-RULES 6.5). Deterministic: flags are returned in a fixed order, blocking
 * first.
 */
export function validationFlags(input: FlagInput): PayrollFlag[] {
  const flags: PayrollFlag[] = [];
  const net = new Decimal(input.net);
  const regular = input.runType !== 'off_cycle';
  if (regular && input.missingSalaryStructure) flags.push('no_salary_structure');
  if (net.isNegative() && !net.isZero()) flags.push('negative_net');
  if (input.sourceCurrencies.some((c) => c !== input.runCurrency)) flags.push('currency_mismatch');
  if (net.isZero()) flags.push('zero_net');
  if (regular && input.daysEmployed < input.daysInPeriod) {
    if (input.joiningDate > input.period.start) flags.push('joiner');
    if (input.separationDate !== null && input.separationDate < input.period.end) flags.push('leaver');
  }
  if (
    regular &&
    input.previousNet !== null &&
    netChangeOverThreshold(input.previousNet, input.net, input.anomalyThresholdPercent)
  )
    flags.push('net_change_over_threshold');
  const threshold = new Decimal(input.reimbursementReviewThreshold);
  if (input.reimbursementAmounts.some((a) => new Decimal(a).greaterThan(threshold)))
    flags.push('large_reimbursement');
  return flags;
}

/**
 * `net_change_over_threshold` (BUSINESS-RULES 6.5): |net − previous| / previous × 100 > threshold. A previous net of
 * zero counts as a change when the new net is not zero.
 */
export function netChangeOverThreshold(previousNet: string, net: string, thresholdPercent: number): boolean {
  const prev = new Decimal(previousNet);
  const diff = new Decimal(net).minus(prev).abs();
  if (prev.isZero()) return !diff.isZero();
  return diff.dividedBy(prev.abs()).times(100).greaterThan(thresholdPercent);
}

/** The top-level submit error for a run's items, or null when nothing blocks (API-STANDARDS §7). */
export function blockingCode(itemFlags: readonly (readonly PayrollFlag[])[]): BlockingCode | null {
  for (const [flag, code] of BLOCKING_FLAGS) {
    if (itemFlags.some((flags) => flags.includes(flag))) return code;
  }
  return null;
}
