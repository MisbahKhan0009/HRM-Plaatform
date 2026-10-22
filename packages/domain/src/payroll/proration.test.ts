import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, daysInclusive, monthPeriod } from '../dates';
import { Decimal, sumMoney, toMoneyString } from '../money';
import { baseSalaryLines, PayrollRuleError, type SalaryStructureInput } from './proration';

const structure = (
  gross: string,
  from = '2000-01-01',
  to: string | null = null,
  id = 's1',
): SalaryStructureInput => ({
  id,
  grossAmount: gross,
  effectiveFrom: from,
  effectiveTo: to,
});

const total = (lines: ReturnType<typeof baseSalaryLines>) =>
  toMoneyString(sumMoney(lines.map((l) => l.amount)));

// Expected values come from docs/07-quality/PAYROLL-TEST-CASES.md (hand-calculated, pending finance sign-off).
describe('baseSalaryLines: documented cases', () => {
  it('pays a full month at the gross amount', () => {
    const lines = baseSalaryLines(
      monthPeriod(2026, 10),
      { joiningDate: '2024-01-03', separationDate: null },
      [structure('65000.00')],
    );
    expect(total(lines)).toBe('65000.00');
  });

  it('prorates a joiner by calendar days (48,000 × 12/31)', () => {
    const lines = baseSalaryLines(
      monthPeriod(2026, 10),
      { joiningDate: '2026-10-20', separationDate: null },
      [structure('48000.00', '2026-10-20')],
    );
    expect(lines[0]?.days).toBe(12);
    expect(total(lines)).toBe('18580.65');
  });

  it('splits a mid-month salary change into two rounded lines (D-041)', () => {
    const lines = baseSalaryLines(
      monthPeriod(2026, 10),
      { joiningDate: '2023-04-17', separationDate: null },
      [
        structure('40000.00', '2025-01-01', '2026-10-15', 'old'),
        structure('46000.00', '2026-10-16', null, 'new'),
      ],
    );
    expect(lines.map((l) => toMoneyString(l.amount))).toEqual(['19354.84', '23741.94']);
    expect(total(lines)).toBe('43096.78');
  });

  it('PAY-12c: rounds an exact half up, not to even', () => {
    const lines = baseSalaryLines(
      monthPeriod(2026, 11),
      { joiningDate: '2026-11-30', separationDate: null },
      [structure('30000.15')],
    );
    expect(total(lines)).toBe('1000.01');
  });

  it('PAY-12d: prorates a leaver, separation day inclusive', () => {
    const lines = baseSalaryLines(
      monthPeriod(2027, 1),
      { joiningDate: '2020-01-01', separationDate: '2027-01-17' },
      [structure('27500.00')],
    );
    expect(total(lines)).toBe('15080.65');
  });

  it('PAY-12e: handles a leap-year February', () => {
    const lines = baseSalaryLines(monthPeriod(2028, 2), { joiningDate: '2028-02-15', separationDate: null }, [
      structure('29000.00'),
    ]);
    expect(total(lines)).toBe('15000.00');
  });

  it('returns no lines for someone not employed in the period', () => {
    expect(
      baseSalaryLines(monthPeriod(2027, 1), { joiningDate: '2027-02-01', separationDate: null }, [
        structure('1.00'),
      ]),
    ).toEqual([]);
  });

  it('flags a missing salary structure', () => {
    expect(() =>
      baseSalaryLines(monthPeriod(2026, 10), { joiningDate: '2026-01-01', separationDate: null }, []),
    ).toThrow(PayrollRuleError);
  });

  it('blocks a mid-period change when the policy is unset', () => {
    expect(() =>
      baseSalaryLines(
        monthPeriod(2026, 10),
        { joiningDate: '2020-01-01', separationDate: null },
        [structure('1.00', '2020-01-01', '2026-10-10', 'a'), structure('2.00', '2026-10-11', null, 'b')],
        { midPeriodPolicy: null },
      ),
    ).toThrow(/mid-period/);
  });
});

describe('baseSalaryLines: properties', () => {
  const grossArb = fc
    .integer({ min: 0, max: 10_000_000_00 })
    .map((cents) => new Decimal(cents).dividedBy(100).toFixed(2));
  const monthArb = fc.record({
    year: fc.integer({ min: 2024, max: 2030 }),
    month: fc.integer({ min: 1, max: 12 }),
  });

  it('never pays more than the gross for one structure, and pays it all for a full month', () => {
    fc.assert(
      fc.property(grossArb, monthArb, fc.integer({ min: 0, max: 30 }), (gross, { year, month }, offset) => {
        const period = monthPeriod(year, month);
        const joining = addDays(period.start, Math.min(offset, daysInclusive(period.start, period.end) - 1));
        const lines = baseSalaryLines(period, { joiningDate: joining, separationDate: null }, [
          structure(gross),
        ]);
        const paid = sumMoney(lines.map((l) => l.amount));
        expect(paid.lte(gross)).toBe(true);
        if (joining === period.start) expect(paid.toFixed(2)).toBe(gross);
      }),
    );
  });

  it('splitting the same gross into two segments changes the total by at most 0.01', () => {
    fc.assert(
      fc.property(grossArb, monthArb, fc.integer({ min: 1, max: 27 }), (gross, { year, month }, split) => {
        const period = monthPeriod(year, month);
        const changeDay = addDays(period.start, split);
        const lines = baseSalaryLines(period, { joiningDate: '2000-01-01', separationDate: null }, [
          structure(gross, '2000-01-01', addDays(changeDay, -1), 'a'),
          structure(gross, changeDay, null, 'b'),
        ]);
        expect(lines.reduce((d, l) => d + l.days, 0)).toBe(daysInclusive(period.start, period.end));
        const diff = sumMoney(lines.map((l) => l.amount))
          .minus(gross)
          .abs();
        expect(diff.lte('0.01')).toBe(true);
      }),
    );
  });
});
