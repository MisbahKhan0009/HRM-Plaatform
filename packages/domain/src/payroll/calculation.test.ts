import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, daysInclusive, monthPeriod } from '../dates';
import { Decimal, sumMoney, toMoneyString } from '../money';
import {
  type AdjustmentInput,
  buildSnapshot,
  type ClaimInput,
  calculateItem,
  calculateOffCycleItem,
  type ItemInput,
  periodLabel,
  type StructureInput,
  shortDate,
} from './calculation';
import { PAYROLL_RULE_VERSION } from './proration';

const s = (gross: string, from = '2025-01-01', to: string | null = null, id = 's1'): StructureInput => ({
  id,
  grossAmount: gross,
  effectiveFrom: from,
  effectiveTo: to,
  currency: 'BDT',
});

const claim = (id: string, amount: string, expenseDate = '2026-12-05'): ClaimInput => ({
  id,
  claimNumber: `RC-${id}`,
  expenseDate,
  amount,
  currency: 'BDT',
});

const adj = (
  id: string,
  type: 'addition' | 'deduction',
  amount: string,
  lineCode: AdjustmentInput['lineCode'] = type,
): AdjustmentInput => ({ id, type, lineCode, amount, reason: `reason ${id}` });

function calc(over: Partial<ItemInput> & { year: number; month: number }) {
  const { year, month, ...rest } = over;
  const r = calculateItem({
    period: monthPeriod(year, month),
    employment: { joiningDate: '2025-01-01', separationDate: null },
    structures: [s('10000.00')],
    claims: [],
    adjustments: [],
    midPeriodPolicy: 'segment_proration',
    ...rest,
  });
  if (!r.ok) throw new Error(r.reason);
  return r.item;
}

const base = (item: ReturnType<typeof calc>) =>
  item.lines.filter((l) => l.code === 'base_salary').map((l) => l.amount);

// docs/07-quality/PAYROLL-TEST-CASES.md: expected values are the hand calculations in that document.
describe('calculateItem: PAYROLL-TEST-CASES', () => {
  it('PAY-01 full month pays the gross', () => {
    const item = calc({ year: 2026, month: 11, structures: [s('52000.00')] });
    expect(item).toMatchObject({ gross: '52000.00', deductions: '0.00', net: '52000.00', daysEmployed: 30 });
    expect(item.lines).toHaveLength(1);
  });

  it('PAY-02 joiner on 15 Feb 2027 is paid 14/28 days', () => {
    const item = calc({
      year: 2027,
      month: 2,
      employment: { joiningDate: '2027-02-15', separationDate: null },
      structures: [s('45000.00', '2027-02-15')],
    });
    expect(item.daysEmployed).toBe(14);
    expect(item.net).toBe('22500.00');
  });

  it('PAY-03 leaver with last day 20 Mar 2027 is paid 20/31 days', () => {
    const item = calc({
      year: 2027,
      month: 3,
      employment: { joiningDate: '2025-01-01', separationDate: '2027-03-20' },
      structures: [s('38500.00')],
    });
    expect(item.daysEmployed).toBe(20);
    expect(item.net).toBe('24838.71');
  });

  it('PAY-04 mid-period change gives two base lines (D-041)', () => {
    const item = calc({
      year: 2027,
      month: 1,
      structures: [
        s('40000.00', '2025-01-01', '2027-01-15', 'old'),
        s('46000.00', '2027-01-16', null, 'new'),
      ],
    });
    expect(base(item)).toEqual(['19354.84', '23741.94']);
    expect(item.lines[0]?.label).toBe('Base salary (2027-01-01 to 2027-01-15)');
    expect(item.net).toBe('43096.78');
    expect(item.structuresUsed.map((x) => x.id)).toEqual(['old', 'new']);
  });

  it('PAY-04 without a mid-period policy fails instead of guessing', () => {
    const r = calculateItem({
      period: monthPeriod(2027, 1),
      employment: { joiningDate: '2025-01-01', separationDate: null },
      structures: [
        s('40000.00', '2025-01-01', '2027-01-15', 'old'),
        s('46000.00', '2027-01-16', null, 'new'),
      ],
      claims: [],
      adjustments: [],
      midPeriodPolicy: null,
    });
    expect(r).toEqual({ ok: false, reason: 'PAYROLL_MIDPERIOD_SALARY_CHANGE_UNCONFIRMED' });
  });

  it('PAY-05 adds one reimbursement line per eligible claim', () => {
    const item = calc({
      year: 2026,
      month: 12,
      structures: [s('30000.00')],
      claims: [claim('2', '1275.50', '2026-12-28'), claim('1', '450.00', '2026-12-10')],
    });
    expect(item.lines.map((l) => [l.code, l.amount])).toEqual([
      ['base_salary', '30000.00'],
      ['reimbursement', '450.00'],
      ['reimbursement', '1275.50'],
    ]);
    expect(item.lines[1]?.label).toBe('Transport reimbursement (10 Dec)');
    expect(item).toMatchObject({ gross: '31725.50', deductions: '0.00', net: '31725.50' });
  });

  it('PAY-06 leave and absences do not change pay (no inputs exist for them)', () => {
    expect(calc({ year: 2026, month: 11, structures: [s('36000.00')] }).net).toBe('36000.00');
  });

  it('PAY-07 applies approved additions and deductions', () => {
    const item = calc({
      year: 2026,
      month: 11,
      structures: [s('35000.00')],
      adjustments: [adj('a', 'addition', '2000.00'), adj('d', 'deduction', '1500.00')],
    });
    expect(item).toMatchObject({ gross: '37000.00', deductions: '1500.00', net: '35500.00' });
    expect(item.lines.find((l) => l.code === 'deduction')?.kind).toBe('deduction');
  });

  it('PAY-07 negative net is possible and left to validation', () => {
    const item = calc({
      year: 2026,
      month: 11,
      structures: [s('1000.00')],
      adjustments: [adj('d', 'deduction', '1500.00')],
    });
    expect(item.net).toBe('-500.00');
  });

  it('PAY-10 arrears addition is an earning with code arrears', () => {
    const item = calc({
      year: 2026,
      month: 12,
      structures: [s('52000.00')],
      adjustments: [adj('x', 'addition', '2000.00', 'arrears')],
    });
    expect(item.lines[1]).toMatchObject({ kind: 'earning', code: 'arrears', amount: '2000.00' });
    expect(item.net).toBe('54000.00');
  });

  it.each([
    ['PAY-12a', '33333.33', '2027-01-10', null, 2027, 1, '23655.91'],
    ['PAY-12b', '10000.01', '2027-01-31', null, 2027, 1, '322.58'],
    ['PAY-12c', '30000.15', '2026-11-30', null, 2026, 11, '1000.01'],
    ['PAY-12d', '27500.00', '2025-01-01', '2027-01-17', 2027, 1, '15080.65'],
    ['PAY-12e', '29000.00', '2028-02-15', null, 2028, 2, '15000.00'],
  ] as const)('%s rounds half-up once per line', (_id, gross, joining, separation, year, month, expected) => {
    const item = calc({
      year,
      month,
      employment: { joiningDate: joining, separationDate: separation },
      structures: [s(gross, '2025-01-01')],
    });
    expect(item.net).toBe(expected);
  });

  it('PAY-13a: no salary structure gives an empty base and the missing flag input', () => {
    const item = calc({ year: 2026, month: 11, structures: [] });
    expect(item).toMatchObject({ missingSalaryStructure: true, net: '0.00', daysEmployed: 30 });
  });

  it('a structure that only covers part of the employed days pays those days', () => {
    const item = calc({ year: 2026, month: 11, structures: [s('30000.00', '2026-11-16')] });
    expect(item.net).toBe('15000.00');
    expect(item.missingSalaryStructure).toBe(false);
  });
});

describe('buildSnapshot (BUSINESS-RULES 6.6)', () => {
  it('stores the rule version, period, employee, structures, lines and totals', () => {
    const period = { ...monthPeriod(2026, 11), year: 2026, month: 11 };
    const item = calc({
      year: 2026,
      month: 11,
      employment: { joiningDate: '2026-11-12', separationDate: null },
      structures: [s('45000.00', '2026-11-12')],
    });
    const snap = buildSnapshot({
      period,
      employee: {
        id: 'e1',
        code: 'EMP-0007',
        name: 'A B',
        department: 'Engineering',
        position: 'QA Engineer',
        joiningDate: '2026-11-12',
        separationDate: null,
      },
      item,
      currency: 'BDT',
    });
    expect(snap).toMatchObject({
      ruleVersion: PAYROLL_RULE_VERSION,
      period: { year: 2026, month: 11, start: '2026-11-01', end: '2026-11-30', daysInPeriod: 30 },
      salaryStructures: [
        { id: 's1', grossAmount: '45000.00', effectiveFrom: '2026-11-12', effectiveTo: null },
      ],
      daysEmployed: 19,
      lines: [{ kind: 'earning', code: 'base_salary', amount: '28500.00' }],
      totals: { gross: '28500.00', deductions: '0.00', net: '28500.00', currency: 'BDT' },
      settings: { rounding: 'half_up_2' },
    });
  });
});

describe('labels', () => {
  it('formats short dates and period labels', () => {
    expect(shortDate('2026-11-02')).toBe('2 Nov');
    expect(periodLabel(2026, 11)).toBe('November 2026');
  });
});

// TESTING-STRATEGY §6: money properties. Amounts are generated as strings, never JS numbers.
const grossArb = fc
  .tuple(fc.integer({ min: 0, max: 999_999_999 }), fc.integer({ min: 0, max: 99 }))
  .map(([w, f]) => `${w}.${String(f).padStart(2, '0')}`);
const monthArb = fc.record({
  year: fc.integer({ min: 2000, max: 2100 }),
  month: fc.integer({ min: 1, max: 12 }),
});

describe('calculateItem: properties', () => {
  it('item totals equal the sum of the rounded lines, and net = gross - deductions', () => {
    fc.assert(
      fc.property(
        monthArb,
        grossArb,
        fc.array(
          grossArb.filter((g) => !new Decimal(g).isZero()),
          { maxLength: 4 },
        ),
        fc.array(
          fc.tuple(
            fc.boolean(),
            grossArb.filter((g) => !new Decimal(g).isZero()),
          ),
          { maxLength: 4 },
        ),
        ({ year, month }, gross, claims, adjustments) => {
          const item = calc({
            year,
            month,
            structures: [s(gross, '2000-01-01')],
            claims: claims.map((a, i) => claim(`c${i}`, a, `${year}-01-01`)),
            adjustments: adjustments.map(([add, a], i) => adj(`a${i}`, add ? 'addition' : 'deduction', a)),
          });
          const earnings = item.lines.filter((l) => l.kind === 'earning').map((l) => l.amount);
          const deductions = item.lines.filter((l) => l.kind === 'deduction').map((l) => l.amount);
          expect(item.gross).toBe(toMoneyString(sumMoney(earnings)));
          expect(item.deductions).toBe(toMoneyString(sumMoney(deductions)));
          expect(new Decimal(item.gross).minus(item.deductions).equals(item.net)).toBe(true);
          for (const l of item.lines) expect(l.amount).toMatch(/^\d+\.\d{2}$/);
        },
      ),
    );
  });

  it('a joiner is paid between 0 and the gross, and a full month pays exactly the gross', () => {
    fc.assert(
      fc.property(monthArb, grossArb, fc.integer({ min: 0, max: 30 }), ({ year, month }, gross, offset) => {
        const period = monthPeriod(year, month);
        const dim = daysInclusive(period.start, period.end);
        const joining = addDays(period.start, Math.min(offset, dim - 1));
        const item = calc({
          year,
          month,
          employment: { joiningDate: joining, separationDate: null },
          structures: [s(gross, '2000-01-01')],
        });
        const net = new Decimal(item.net);
        expect(net.greaterThanOrEqualTo(0) && net.lessThanOrEqualTo(gross)).toBe(true);
        if (joining === period.start) expect(item.net).toBe(toMoneyString(gross));
      }),
    );
  });

  it('recalculating the same inputs gives identical items (BUSINESS-RULES 6.7)', () => {
    fc.assert(
      fc.property(monthArb, grossArb, ({ year, month }, gross) => {
        const input = {
          year,
          month,
          structures: [s(gross, '2000-01-01')],
          claims: [claim('c', '10.00', `${year}-01-01`)],
        };
        expect(calc(input)).toEqual(calc(input));
      }),
    );
  });
});

// BUSINESS-RULES 6.10: an off-cycle item pays only claims and adjustments.
describe('calculateOffCycleItem', () => {
  const period = monthPeriod(2026, 11);

  it('pays a claim and an addition less a deduction, with no salary lines', () => {
    const item = calculateOffCycleItem({
      period,
      claims: [claim('c1', '650.00', '2026-11-12')],
      adjustments: [adj('a1', 'addition', '1000.00'), adj('d1', 'deduction', '250.50')],
    });
    expect(item).not.toBeNull();
    expect(item?.lines.map((l) => [l.kind, l.code, l.amount, l.sortOrder])).toEqual([
      ['earning', 'reimbursement', '650.00', 0],
      ['earning', 'addition', '1000.00', 1],
      ['deduction', 'deduction', '250.50', 2],
    ]);
    expect(item).toMatchObject({
      gross: '1650.00',
      deductions: '250.50',
      net: '1399.50',
      daysEmployed: 0,
      daysInPeriod: 30,
      structuresUsed: [],
      missingSalaryStructure: false,
    });
  });

  it('returns null when there is nothing to pay', () => {
    expect(calculateOffCycleItem({ period, claims: [], adjustments: [] })).toBeNull();
  });

  it('a snapshot of an off-cycle item records the run type and no salary structure', () => {
    const item = calculateOffCycleItem({ period, claims: [claim('c1', '10.00')], adjustments: [] });
    if (!item) throw new Error('expected an item');
    const snap = buildSnapshot({
      period: { ...period, year: 2026, month: 11 },
      employee: {
        id: 'e',
        code: 'EMP-1',
        name: 'A B',
        department: null,
        position: null,
        joiningDate: '2025-01-01',
        separationDate: '2026-10-31',
      },
      item,
      currency: 'BDT',
      runType: 'off_cycle',
    });
    expect(snap).toMatchObject({ runType: 'off_cycle', salaryStructures: [], daysEmployed: 0 });
    expect(snap.lines.some((l) => l.code === 'base_salary')).toBe(false);
  });
});

describe('calculateOffCycleItem: properties', () => {
  const amountArb = fc
    .tuple(fc.integer({ min: 0, max: 99_999_999 }), fc.integer({ min: 0, max: 99 }))
    .filter(([w, f]) => w + f > 0)
    .map(([w, f]) => `${w}.${String(f).padStart(2, '0')}`);
  const claimsArb = fc.array(fc.record({ amount: amountArb, day: fc.integer({ min: 1, max: 28 }) }), {
    maxLength: 6,
  });
  const adjustmentsArb = fc.array(
    fc.record({
      amount: amountArb,
      type: fc.constantFrom<'addition' | 'deduction'>('addition', 'deduction'),
    }),
    { maxLength: 6 },
  );
  const inputs = (
    cs: { amount: string; day: number }[],
    as: { amount: string; type: 'addition' | 'deduction' }[],
  ) => ({
    claims: cs.map((c, i) => claim(`c${i}`, c.amount, `2026-11-${String(c.day).padStart(2, '0')}`)),
    adjustments: as.map((a, i) => adj(`a${i}`, a.type, a.amount)),
  });

  it('net = claims + additions - deductions, computed from the inputs, and every input becomes one line', () => {
    fc.assert(
      fc.property(monthArb, claimsArb, adjustmentsArb, ({ year, month }, cs, as) => {
        const { claims, adjustments } = inputs(cs, as);
        const item = calculateOffCycleItem({ period: monthPeriod(year, month), claims, adjustments });
        if (!claims.length && !adjustments.length) {
          expect(item).toBeNull();
          return;
        }
        if (!item) throw new Error('expected an item');
        const expected = new Decimal(sumMoney(cs.map((c) => c.amount)))
          .plus(sumMoney(as.filter((a) => a.type === 'addition').map((a) => a.amount)))
          .minus(sumMoney(as.filter((a) => a.type === 'deduction').map((a) => a.amount)));
        expect(item.net).toBe(toMoneyString(expected));
        expect(new Decimal(item.gross).minus(item.deductions).equals(item.net)).toBe(true);
        expect(item.lines).toHaveLength(claims.length + adjustments.length);
        expect(new Set(item.lines.map((l) => l.sourceId))).toEqual(
          new Set([...claims, ...adjustments].map((x) => x.id)),
        );
        for (const l of item.lines) {
          expect(typeof l.amount).toBe('string');
          expect(l.amount).toMatch(/^\d+\.\d{2}$/);
          expect(l.code).not.toBe('base_salary');
        }
        expect(item.daysEmployed).toBe(0);
      }),
    );
  });

  it('pays the same claim and adjustment lines as a regular item over the same inputs', () => {
    fc.assert(
      fc.property(claimsArb, adjustmentsArb, (cs, as) => {
        fc.pre(cs.length + as.length > 0);
        const { claims, adjustments } = inputs(cs, as);
        const off = calculateOffCycleItem({ period: monthPeriod(2026, 11), claims, adjustments });
        const regular = calc({ year: 2026, month: 11, claims, adjustments });
        const strip = (ls: { kind: string; code: string; amount: string; sourceId: string }[]) =>
          ls
            .filter((l) => l.code !== 'base_salary')
            .map(({ kind, code, amount, sourceId }) => ({ kind, code, amount, sourceId }));
        expect(strip(off?.lines ?? [])).toEqual(strip(regular.lines));
      }),
    );
  });
});
