import { daysInclusive, type IsoDate } from '../dates';
import { Decimal, sumMoney, toMoneyString } from '../money';
import {
  baseSalaryLines,
  type Employment,
  employedRange,
  PAYROLL_RULE_VERSION,
  PayrollRuleError,
  type Period,
  type SalaryStructureInput,
} from './proration';

export type PayrollLineKind = 'earning' | 'deduction';
export type PayrollLineCode = 'base_salary' | 'reimbursement' | 'addition' | 'deduction' | 'arrears';
export type PayrollLineSource = 'salary_structure' | 'reimbursement_claim' | 'payroll_adjustment';

export interface StructureInput extends SalaryStructureInput {
  currency: string;
}

/** An approved claim eligible for the period (BUSINESS-RULES 6.4). */
export interface ClaimInput {
  id: string;
  claimNumber: string;
  expenseDate: IsoDate;
  amount: string;
  currency: string;
}

/** An approved adjustment targeting the period (BUSINESS-RULES 6.4, DOMAIN-MODEL 5.7). */
export interface AdjustmentInput {
  id: string;
  type: 'addition' | 'deduction';
  lineCode: 'addition' | 'deduction' | 'arrears';
  amount: string;
  reason: string;
}

export interface ItemInput {
  period: Period;
  employment: Employment;
  structures: readonly StructureInput[];
  claims: readonly ClaimInput[];
  adjustments: readonly AdjustmentInput[];
  midPeriodPolicy: 'segment_proration' | null;
}

export interface CalculatedLine {
  kind: PayrollLineKind;
  code: PayrollLineCode;
  label: string;
  /** Rounded, non-negative; the sign comes from `kind`. */
  amount: string;
  sortOrder: number;
  sourceType: PayrollLineSource;
  sourceId: string;
  calculation: Record<string, unknown>;
}

export interface CalculatedItem {
  lines: CalculatedLine[];
  gross: string;
  deductions: string;
  net: string;
  daysEmployed: number;
  daysInPeriod: number;
  /** Structures that produced base lines, in date order. */
  structuresUsed: StructureInput[];
  missingSalaryStructure: boolean;
}

export type ItemResult =
  | { ok: true; item: CalculatedItem }
  | { ok: false; reason: 'PAYROLL_MIDPERIOD_SALARY_CHANGE_UNCONFIRMED' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "12 Nov" from "2026-11-12" (label of a reimbursement line, BUSINESS-RULES 6.4). */
export function shortDate(date: IsoDate): string {
  const [, m, d] = date.split('-');
  const month = MONTHS[Math.max(0, Math.min(11, Number.parseInt(m ?? '1', 10) - 1))];
  return `${Number.parseInt(d ?? '1', 10)} ${month}`;
}

/**
 * One employee's item for a period (BUSINESS-RULES 6.2–6.4): prorated base salary lines (one per structure segment,
 * D-041), one earning line per approved claim, one line per approved adjustment. Each line is rounded half-up to
 * 2 places; totals are sums of rounded lines (ADR-0006). Leave and attendance never enter (D-017).
 */
export function calculateItem(input: ItemInput): ItemResult {
  const daysInPeriod = daysInclusive(input.period.start, input.period.end);
  const employed = employedRange(input.period, input.employment);
  const daysEmployed = employed ? daysInclusive(employed.start, employed.end) : 0;

  let base: ReturnType<typeof baseSalaryLines> = [];
  let missingSalaryStructure = false;
  try {
    base = baseSalaryLines(input.period, input.employment, input.structures, {
      midPeriodPolicy: input.midPeriodPolicy,
    });
    if (employed && base.length === 0) missingSalaryStructure = true;
  } catch (err) {
    if (!(err instanceof PayrollRuleError)) throw err;
    if (err.code === 'PAYROLL_MIDPERIOD_SALARY_CHANGE_UNCONFIRMED') return { ok: false, reason: err.code };
    missingSalaryStructure = true;
  }

  const split = base.length > 1;
  const lines: CalculatedLine[] = [];
  for (const b of base) {
    lines.push({
      kind: 'earning',
      code: 'base_salary',
      label: split ? `Base salary (${b.from} to ${b.to})` : 'Base salary',
      amount: toMoneyString(b.amount),
      sortOrder: lines.length,
      sourceType: 'salary_structure',
      sourceId: b.salaryStructureId,
      calculation: {
        grossAmount: toMoneyString(b.grossAmount),
        days: b.days,
        daysInPeriod: b.daysInPeriod,
        from: b.from,
        to: b.to,
        salaryStructureId: b.salaryStructureId,
      },
    });
  }
  const claims = [...input.claims].sort((a, b) =>
    a.expenseDate === b.expenseDate
      ? a.claimNumber < b.claimNumber
        ? -1
        : 1
      : a.expenseDate < b.expenseDate
        ? -1
        : 1,
  );
  for (const c of claims) {
    lines.push({
      kind: 'earning',
      code: 'reimbursement',
      label: `Transport reimbursement (${shortDate(c.expenseDate)})`,
      amount: toMoneyString(c.amount),
      sortOrder: lines.length,
      sourceType: 'reimbursement_claim',
      sourceId: c.id,
      calculation: { claimNumber: c.claimNumber, expenseDate: c.expenseDate, currency: c.currency },
    });
  }
  for (const a of input.adjustments) {
    lines.push({
      kind: a.type === 'deduction' ? 'deduction' : 'earning',
      code: a.lineCode,
      label: a.reason,
      amount: toMoneyString(a.amount),
      sortOrder: lines.length,
      sourceType: 'payroll_adjustment',
      sourceId: a.id,
      calculation: { adjustmentType: a.type },
    });
  }

  const gross = sumMoney(lines.filter((l) => l.kind === 'earning').map((l) => l.amount));
  const deductions = sumMoney(lines.filter((l) => l.kind === 'deduction').map((l) => l.amount));
  const used = new Set(base.map((b) => b.salaryStructureId));
  return {
    ok: true,
    item: {
      lines,
      gross: toMoneyString(gross),
      deductions: toMoneyString(deductions),
      net: toMoneyString(new Decimal(gross).minus(deductions)),
      daysEmployed,
      daysInPeriod,
      structuresUsed: input.structures
        .filter((s) => used.has(s.id))
        .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1)),
      missingSalaryStructure,
    },
  };
}

export interface SnapshotEmployee {
  id: string;
  code: string;
  name: string;
  department: string | null;
  position: string | null;
  joiningDate: IsoDate;
  separationDate: IsoDate | null;
}

/** The item snapshot (BUSINESS-RULES 6.6, FR-PAY-007): everything needed to reproduce the item. */
export function buildSnapshot(input: {
  period: Period & { year: number; month: number };
  employee: SnapshotEmployee;
  item: CalculatedItem;
  currency: string;
}) {
  const { item } = input;
  return {
    ruleVersion: PAYROLL_RULE_VERSION,
    period: {
      year: input.period.year,
      month: input.period.month,
      start: input.period.start,
      end: input.period.end,
      daysInPeriod: item.daysInPeriod,
    },
    employee: input.employee,
    salaryStructures: item.structuresUsed.map((s) => ({
      id: s.id,
      grossAmount: toMoneyString(s.grossAmount),
      effectiveFrom: s.effectiveFrom,
      effectiveTo: s.effectiveTo,
      currency: s.currency,
    })),
    daysEmployed: item.daysEmployed,
    lines: item.lines.map((l) => ({
      kind: l.kind,
      code: l.code,
      label: l.label,
      amount: l.amount,
      sourceType: l.sourceType,
      sourceId: l.sourceId,
      calculation: l.calculation,
    })),
    totals: { gross: item.gross, deductions: item.deductions, net: item.net, currency: input.currency },
    settings: { rounding: 'half_up_2' },
  };
}
export type PayrollSnapshot = ReturnType<typeof buildSnapshot>;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** "November 2026" for a payroll period (EMAIL.md: payslip email subject). */
export const periodLabel = (year: number, month: number) => `${MONTH_NAMES[month - 1] ?? ''} ${year}`.trim();
