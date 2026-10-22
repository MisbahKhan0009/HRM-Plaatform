import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api/client';
import { ClaimFormSchema, flattenAmountErrors, normaliseAmount, toMoney } from './form';

describe('normaliseAmount', () => {
  it.each([
    ['350', '350.00'],
    ['350.5', '350.50'],
    ['1,850.25', '1850.25'],
    [' 0012.30 ', '12.30'],
    ['0.5', '0.50'],
  ])('%j → %j', (input, out) => {
    expect(normaliseAmount(input)).toBe(out);
  });

  it.each(['', 'abc', '1.234', '-5', '1e3', '12.'])('rejects %j', (input) => {
    expect(normaliseAmount(input)).toBeNull();
  });

  it('keeps every digit of large amounts, which a JS number would round', () => {
    expect(normaliseAmount('999999999999.99')).toBe('999999999999.99');
  });
});

describe('ClaimFormSchema', () => {
  const ok = { expenseDate: '2026-01-05', amount: '350', description: 'Client visit' };
  it('accepts a valid claim', () => {
    expect(ClaimFormSchema.safeParse(ok).success).toBe(true);
  });
  it('requires the date of travel', () => {
    const r = ClaimFormSchema.safeParse({ ...ok, expenseDate: '' });
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual(['expenseDate']);
  });
  it('rejects a zero amount and a future date', () => {
    expect(ClaimFormSchema.safeParse({ ...ok, amount: '0.00' }).success).toBe(false);
    expect(ClaimFormSchema.safeParse({ ...ok, expenseDate: '2999-01-01' }).success).toBe(false);
  });
  it('sends the amount as a money object', () => {
    expect(toMoney('350.5')).toEqual({ amount: '350.50', currency: 'BDT' });
  });
});

describe('flattenAmountErrors', () => {
  it('moves /amount/amount errors to the amount field', () => {
    const err = new ApiError(
      400,
      'VALIDATION_FAILED',
      'x',
      [{ path: '/amount/amount', code: 'c', message: 'm' }],
      null,
      null,
    );
    const out = flattenAmountErrors(err) as ApiError;
    expect(out.errors[0]?.path).toBe('/amount');
  });
});
