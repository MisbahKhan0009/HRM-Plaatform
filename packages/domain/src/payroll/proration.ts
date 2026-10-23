import { daysInclusive, type IsoDate, maxDate, minDate } from '../dates';
import { Decimal, roundMoney } from '../money';

/** Payroll rules version stored with every snapshot (BUSINESS-RULES §6). */
export const PAYROLL_RULE_VERSION = 'payroll-v1.1';

export interface Period {
  start: IsoDate;
  end: IsoDate;
}

export interface Employment {
  joiningDate: IsoDate;
  /** Last employed day, inclusive; null while employed (BUSINESS-RULES §6.2). */
  separationDate: IsoDate | null;
}

export interface SalaryStructureInput {
  id: string;
  /** Gross monthly amount as a decimal string. */
  grossAmount: string;
  effectiveFrom: IsoDate;
  /** Inclusive; null when open-ended. */
  effectiveTo: IsoDate | null;
}

export interface BaseSalaryLine {
  salaryStructureId: string;
  from: IsoDate;
  to: IsoDate;
  days: number;
  daysInPeriod: number;
  grossAmount: string;
  amount: Decimal;
}

export class PayrollRuleError extends Error {
  constructor(
    readonly code: 'PAYROLL_MISSING_SALARY_STRUCTURE' | 'PAYROLL_MIDPERIOD_SALARY_CHANGE_UNCONFIRMED',
    message: string,
  ) {
    super(message);
    this.name = 'PayrollRuleError';
  }
}

/** The employed part of the period, or null when the employee is not employed in it (§6.1–6.2). */
export function employedRange(period: Period, employment: Employment): Period | null {
  const from = maxDate(period.start, employment.joiningDate);
  const to = minDate(period.end, employment.separationDate ?? period.end);
  return from <= to ? { start: from, end: to } : null;
}

/**
 * Base salary lines for one employee and period (BUSINESS-RULES §6.3, D-022, D-041).
 * One line per salary structure overlapping the employed range, each prorated by calendar days:
 * `round_half_up(gross × days / daysInPeriod, 2)`.
 */
export function baseSalaryLines(
  period: Period,
  employment: Employment,
  structures: readonly SalaryStructureInput[],
  options: { midPeriodPolicy: 'segment_proration' | null } = { midPeriodPolicy: 'segment_proration' },
): BaseSalaryLine[] {
  const employed = employedRange(period, employment);
  if (!employed) return [];

  const daysInPeriod = daysInclusive(period.start, period.end);
  const segments = structures
    .map((s) => ({
      s,
      from: maxDate(employed.start, s.effectiveFrom),
      to: minDate(employed.end, s.effectiveTo ?? employed.end),
    }))
    .filter((seg) => seg.from <= seg.to)
    .sort((a, b) => (a.from < b.from ? -1 : 1));

  if (segments.length === 0) {
    throw new PayrollRuleError(
      'PAYROLL_MISSING_SALARY_STRUCTURE',
      'No salary structure covers the employed days.',
    );
  }
  if (segments.length > 1 && options.midPeriodPolicy !== 'segment_proration') {
    throw new PayrollRuleError(
      'PAYROLL_MIDPERIOD_SALARY_CHANGE_UNCONFIRMED',
      'Salary changes inside the period and no mid-period policy is set.',
    );
  }

  return segments.map(({ s, from, to }) => {
    const days = daysInclusive(from, to);
    return {
      salaryStructureId: s.id,
      from,
      to,
      days,
      daysInPeriod,
      grossAmount: s.grossAmount,
      amount: roundMoney(new Decimal(s.grossAmount).times(days).dividedBy(daysInPeriod)),
    };
  });
}
