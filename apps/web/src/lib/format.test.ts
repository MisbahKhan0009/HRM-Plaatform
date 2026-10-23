import { describe, expect, it } from 'vitest';
import { formatDateRange, formatDays, formatDuration, formatMoney, todayIso } from './format';

describe('formats (CONTENT-STYLE §8)', () => {
  it('formats money from decimal strings without converting to numbers', () => {
    expect(formatMoney('45000.00')).toBe('৳ 45,000.00');
    expect(formatMoney('-1234567.5')).toBe('-৳ 1,234,567.50');
    expect(formatMoney('99999999999999.99')).toBe('৳ 99,999,999,999,999.99');
  });

  it('formats date ranges', () => {
    expect(formatDateRange('2026-11-03', '2026-11-05')).toBe('3 to 5 Nov 2026');
    expect(formatDateRange('2026-10-30', '2026-11-02')).toBe('30 Oct to 2 Nov 2026');
    expect(formatDateRange('2026-12-30', '2027-01-02')).toBe('30 Dec 2026 to 2 Jan 2027');
  });

  it('formats leave days and durations', () => {
    expect(formatDays('1.00')).toBe('1 day');
    expect(formatDays('0.50')).toBe('0.5 day');
    expect(formatDays('2.50')).toBe('2.5 days');
    expect(formatDuration(485)).toBe('8h 05m');
  });

  it('uses the Dhaka date for today', () => {
    expect(todayIso(new Date('2026-11-03T18:30:00Z'))).toBe('2026-11-04');
  });
});
