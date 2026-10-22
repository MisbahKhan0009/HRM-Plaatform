import type { PayrollFlag } from '@hrm/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  blockingCode,
  type FlagInput,
  isBlockingFlag,
  netChangeOverThreshold,
  validationFlags,
} from './validation';

const input = (over: Partial<FlagInput> = {}): FlagInput => ({
  period: { start: '2026-11-01', end: '2026-11-30' },
  joiningDate: '2025-01-01',
  separationDate: null,
  daysEmployed: 30,
  daysInPeriod: 30,
  missingSalaryStructure: false,
  net: '1000.00',
  runCurrency: 'BDT',
  sourceCurrencies: ['BDT'],
  previousNet: null,
  anomalyThresholdPercent: 20,
  reimbursementAmounts: [],
  reimbursementReviewThreshold: '5000.00',
  ...over,
});

describe('validationFlags (BUSINESS-RULES 6.5)', () => {
  it.each<[string, Partial<FlagInput>, PayrollFlag[]]>([
    ['a normal item has no flags', {}, []],
    [
      'PAY-13a missing structure',
      { missingSalaryStructure: true, net: '0.00' },
      ['no_salary_structure', 'zero_net'],
    ],
    ['negative net', { net: '-0.01' }, ['negative_net']],
    ['currency mismatch', { sourceCurrencies: ['BDT', 'USD'] }, ['currency_mismatch']],
    ['zero net', { net: '0.00' }, ['zero_net']],
    ['joiner', { joiningDate: '2026-11-12', daysEmployed: 19 }, ['joiner']],
    ['leaver', { separationDate: '2026-11-10', daysEmployed: 10 }, ['leaver']],
    [
      'joiner and leaver',
      { joiningDate: '2026-11-05', separationDate: '2026-11-10', daysEmployed: 6 },
      ['joiner', 'leaver'],
    ],
    [
      'PAY-13d net up 21% from the previous run',
      { previousNet: '1000.00', net: '1210.00' },
      ['net_change_over_threshold'],
    ],
    ['net up exactly 20% is not over the threshold', { previousNet: '1000.00', net: '1200.00' }, []],
    ['net down more than 20%', { previousNet: '1000.00', net: '799.99' }, ['net_change_over_threshold']],
    ['large reimbursement', { reimbursementAmounts: ['5000.01'] }, ['large_reimbursement']],
    ['reimbursement equal to the threshold', { reimbursementAmounts: ['5000.00'] }, []],
  ])('%s', (_name, over, expected) => {
    expect(validationFlags(input(over))).toEqual(expected);
  });
});

describe('netChangeOverThreshold', () => {
  it('treats a change from zero as over the threshold', () => {
    expect(netChangeOverThreshold('0.00', '10.00', 20)).toBe(true);
    expect(netChangeOverThreshold('0.00', '0.00', 20)).toBe(false);
  });
});

describe('blockingCode (API-STANDARDS "Payroll blocking codes")', () => {
  it('returns null when nothing blocks', () => {
    expect(blockingCode([['joiner'], ['zero_net', 'net_change_over_threshold']])).toBeNull();
  });

  it('picks the first code in the documented order across all items', () => {
    expect(blockingCode([['currency_mismatch'], ['negative_net']])).toBe('PAYROLL_NEGATIVE_NET');
    expect(blockingCode([['negative_net'], ['no_salary_structure', 'zero_net']])).toBe(
      'PAYROLL_MISSING_SALARY_STRUCTURE',
    );
    expect(blockingCode([['currency_mismatch']])).toBe('PAYROLL_CURRENCY_MISMATCH');
  });

  it('is blocking exactly when an item carries a blocking flag', () => {
    const flag = fc.constantFrom<PayrollFlag>(
      'no_salary_structure',
      'negative_net',
      'currency_mismatch',
      'zero_net',
      'joiner',
      'leaver',
      'net_change_over_threshold',
      'large_reimbursement',
    );
    fc.assert(
      fc.property(fc.array(fc.array(flag, { maxLength: 4 }), { maxLength: 6 }), (items) => {
        expect(blockingCode(items) !== null).toBe(items.some((f) => f.some(isBlockingFlag)));
      }),
    );
  });
});
