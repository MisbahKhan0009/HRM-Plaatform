import { describe, expect, it } from 'vitest';
import { ERROR_STATUS } from './errors';
import { MoneyAmountSchema, PageQuerySchema } from './primitives';

describe('MoneyAmountSchema', () => {
  it('accepts 2-decimal strings', () => {
    expect(MoneyAmountSchema.parse('45000.00')).toBe('45000.00');
    expect(MoneyAmountSchema.parse('-3000.00')).toBe('-3000.00');
  });
  it('rejects numbers and other precisions', () => {
    expect(MoneyAmountSchema.safeParse(45000).success).toBe(false);
    expect(MoneyAmountSchema.safeParse('45000.5').success).toBe(false);
  });
});

describe('PageQuerySchema', () => {
  it('defaults and bounds page size', () => {
    expect(PageQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(PageQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
  });
});

describe('error catalogue', () => {
  it('maps codes to HTTP statuses', () => {
    expect(ERROR_STATUS.NOT_FOUND).toBe(404);
    expect(ERROR_STATUS.PAYROLL_RUN_LOCKED).toBe(409);
  });
});
