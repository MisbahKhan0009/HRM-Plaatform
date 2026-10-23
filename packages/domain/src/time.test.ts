import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { businessDayBounds, eachDate, minutesBetween, toBusinessDate, weekday, zonedInstant } from './time';

describe('business time (Asia/Dhaka, UTC+6)', () => {
  it('maps late-evening UTC to the next Dhaka date', () => {
    expect(toBusinessDate(new Date('2026-11-03T17:59:59Z'))).toBe('2026-11-03');
    expect(toBusinessDate(new Date('2026-11-03T18:00:00Z'))).toBe('2026-11-04');
  });

  it('builds wall-clock instants', () => {
    expect(zonedInstant('2026-11-03', '10:00').toISOString()).toBe('2026-11-03T04:00:00.000Z');
    const { start, end } = businessDayBounds('2026-11-03');
    expect(start.toISOString()).toBe('2026-11-02T18:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-03T18:00:00.000Z');
  });

  it('numbers weekdays from Sunday = 0 (D-005 Sun–Thu working week)', () => {
    expect(weekday('2026-11-01')).toBe(0); // Sunday
    expect(weekday('2026-11-06')).toBe(5); // Friday
  });

  it('lists dates inclusively and floors minutes', () => {
    expect(eachDate('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(eachDate('2026-01-02', '2026-01-01')).toEqual([]);
    expect(minutesBetween(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:01:59Z'))).toBe(1);
    expect(minutesBetween(new Date('2026-01-01T01:00:00Z'), new Date('2026-01-01T00:00:00Z'))).toBe(0);
  });

  it('round-trips any instant through its business date bounds', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2000-01-01'), max: new Date('2100-01-01'), noInvalidDate: true }),
        (d) => {
          const { start, end } = businessDayBounds(toBusinessDate(d));
          return start.getTime() <= d.getTime() && d.getTime() < end.getTime();
        },
      ),
    );
  });
});
