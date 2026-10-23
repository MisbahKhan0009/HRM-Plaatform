import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Decimal } from '../money';
import {
  capToMaxBalance,
  carryForwardExpiry,
  carryForwardExpiryDate,
  eligibilityDate,
  floorToHalf,
  isEligibleOn,
  monthlyAccrual,
  perDaysWorkedAccrual,
  proratedAnnualGrant,
  remainingMonths,
  yearEndCarry,
} from './accrual';

describe('floorToHalf (BUSINESS-RULES 5.3)', () => {
  it.each([
    ['8.33', '8'],
    ['7.5', '7.5'],
    ['7.99', '7.5'],
    ['10', '10'],
    ['0.49', '0'],
  ])('floor_to_half(%s) = %s', (x, expected) => {
    expect(floorToHalf(x).toString()).toBe(expected);
  });

  it('property: result is a multiple of 0.5, at most x, and within 0.5 of x', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), (hundredths) => {
        const x = new Decimal(hundredths).div(100);
        const r = floorToHalf(x);
        return r.times(2).isInteger() && r.lte(x) && x.minus(r).lt(0.5);
      }),
    );
  });
});

describe('annual_grant proration (BUSINESS-RULES 5.1)', () => {
  it.each([
    ['5.1 example: CL 10, eligible 20 March: 9 months, 7.5', '10', '2026-03-20', true, 9, '7.5'],
    [
      '5.1 example: CL 10, eligible 10 March: 10 months, 8.33 rounded down to 8',
      '10',
      '2026-03-10',
      true,
      10,
      '8',
    ],
    ['eligible on the 15th counts that month', '14', '2026-06-15', true, 7, '8'],
    ['eligible on the 16th does not count that month', '14', '2026-06-16', true, 6, '7'],
    ['eligible 1 January gets 12 months', '10', '2026-01-01', true, 12, '10'],
    ['eligible 31 December gets nothing', '10', '2026-12-31', true, 0, '0'],
    ['prorate_first_year = false grants the full entitlement', '10', '2026-09-20', false, 3, '10'],
  ] as const)('%s', (_rule, entitlement, date, prorate, months, expected) => {
    expect(remainingMonths(date)).toBe(months);
    expect(proratedAnnualGrant(entitlement, date, prorate).toString()).toBe(expected);
  });

  it('property: a prorated grant is between 0 and the entitlement and a multiple of 0.5', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4000 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        (hundredths, month, day) => {
          const e = new Decimal(hundredths).div(100);
          const date = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const g = proratedAnnualGrant(e, date, true);
          return g.gte(0) && g.lte(e) && g.times(2).isInteger();
        },
      ),
    );
  });
});

describe('eligibility', () => {
  const base = {
    status: 'active',
    joiningDate: '2025-03-01',
    separationDate: null,
    eligibleStatuses: ['probation', 'active', 'notice_period'],
    eligibilityAfterDays: 365,
  };
  it('AL seed default: eligible 365 days after joining', () => {
    expect(eligibilityDate('2025-03-01', 365)).toBe('2026-03-01');
    expect(isEligibleOn(base, '2026-02-28')).toBe(false);
    expect(isEligibleOn(base, '2026-03-01')).toBe(true);
  });
  it('is not eligible outside the eligible statuses, before joining or after separation', () => {
    expect(isEligibleOn({ ...base, status: 'separated' }, '2026-06-01')).toBe(false);
    expect(isEligibleOn({ ...base, joiningDate: null }, '2026-06-01')).toBe(false);
    expect(isEligibleOn({ ...base, separationDate: '2026-05-31' }, '2026-06-01')).toBe(false);
  });
});

describe('per_days_worked accrual (BUSINESS-RULES 5.3)', () => {
  it.each([
    ['5.3 example: 180 days by 31 Aug, 18 per unit, 9.5 already: post 0.5', 180, '9.5', '9.5', null, '0.5'],
    ['nothing new to post', 180, '10', '10', null, '0'],
    ['first posting after eligibility includes earlier days', 100, '0', '0', null, '5.5'],
    ['capped so available does not exceed max_balance 40', 180, '0', '35', '40', '5'],
    ['nothing when available is already at max_balance', 180, '0', '40', '40', '0'],
  ] as const)('%s', (_rule, worked, already, available, max, expected) => {
    expect(
      perDaysWorkedAccrual({
        workedDaysYtd: worked,
        daysWorkedPerUnit: '18',
        alreadyAccrued: already,
        available,
        maxBalance: max,
      }).toString(),
    ).toBe(expected);
  });

  it('property: never negative and never lifts available above max_balance', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 366 }),
        fc.integer({ min: 0, max: 80 }),
        fc.integer({ min: 0, max: 80 }),
        fc.integer({ min: 0, max: 80 }),
        (worked, already2, available2, max) => {
          const available = new Decimal(available2).div(2);
          const p = perDaysWorkedAccrual({
            workedDaysYtd: worked,
            daysWorkedPerUnit: '18',
            alreadyAccrued: new Decimal(already2).div(2),
            available,
            maxBalance: max,
          });
          return p.gte(0) && (p.isZero() || available.plus(p).lte(max));
        },
      ),
    );
  });

  it('monthly accrual posts accrual_per_month, capped by max_balance', () => {
    expect(monthlyAccrual('1.25', '3', null).toString()).toBe('1.25');
    expect(monthlyAccrual('1.25', '9.5', '10').toString()).toBe('0.5');
    expect(capToMaxBalance('2', '12', '10').toString()).toBe('0');
  });
});

describe('year end (BUSINESS-RULES 5.4)', () => {
  it.each([
    ['NULL max_carry_forward carries nothing and expires all', '6', null, '0', '6'],
    ['carries up to max_carry_forward and expires the rest', '6', '4', '4', '2'],
    ['carries everything under the limit', '3', '4', '3', '0'],
    ['nothing moves when available is zero', '0', '4', '0', '0'],
    ['nothing moves when available is negative', '-1', '4', '0', '0'],
  ] as const)('%s', (_rule, available, max, carry, expiry) => {
    const r = yearEndCarry(available, max);
    expect([r.carry.toString(), r.expiry.toString()]).toEqual([carry, expiry]);
  });

  it('property: carry + expiry = max(available, 0) and carry <= max_carry_forward', () => {
    fc.assert(
      fc.property(fc.integer({ min: -20, max: 120 }), fc.integer({ min: 0, max: 40 }), (a2, max) => {
        const available = new Decimal(a2).div(2);
        const r = yearEndCarry(available, max);
        return r.carry.plus(r.expiry).eq(Decimal.max(available, 0)) && r.carry.lte(max) && r.expiry.gte(0);
      }),
    );
  });

  it.each([
    ['usage consumes carried days first', '5', '2', '10', '3'],
    ['all carried days used', '5', '6', '10', '0'],
    ['never more than available', '5', '0', '1.5', '1.5'],
  ] as const)('carry-forward expiry: %s', (_rule, carry, used, available, expected) => {
    expect(carryForwardExpiry(carry, used, available).toString()).toBe(expected);
  });

  it('carry-forward expiry date is N months after 1 January, inside the leave year', () => {
    expect(carryForwardExpiryDate(2027, 3)).toBe('2027-04-01');
    expect(carryForwardExpiryDate(2027, 11)).toBe('2027-12-01');
    expect(carryForwardExpiryDate(2027, 12)).toBeNull();
  });
});
