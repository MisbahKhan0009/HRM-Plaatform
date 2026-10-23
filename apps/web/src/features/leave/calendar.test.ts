import type { LeaveCalendarEntry } from '@hrm/contracts';
import { describe, expect, it } from 'vitest';
import { byPerson, monthBounds, monthDays, segments, shiftMonth, weekday } from './calendar';

const entry = (over: Partial<LeaveCalendarEntry>): LeaveCalendarEntry => ({
  employeeId: '00000000-0000-4000-8000-000000000001',
  employeeName: 'Eman Employee',
  startDate: '2026-11-03',
  endDate: '2026-11-05',
  unit: 'day',
  halfDayPart: null,
  status: 'approved',
  ...over,
});

describe('leave calendar helpers', () => {
  it('bounds and lists every day of a month, leap years included', () => {
    expect(monthBounds('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthBounds('2028-02').to).toBe('2028-02-29');
    expect(monthDays('2026-02')).toHaveLength(28);
    expect(monthDays('2026-12').at(-1)).toBe('2026-12-31');
  });

  it('shifts months across years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('knows the weekday of a business date without the device zone', () => {
    expect(weekday('2026-11-01')).toBe(0); // Sunday
    expect(weekday('2026-11-06')).toBe(5); // Friday
  });

  it('groups entries per person by name', () => {
    const rows = byPerson([
      entry({ employeeId: '00000000-0000-4000-8000-000000000002', employeeName: 'Bilal Second' }),
      entry({}),
      entry({ startDate: '2026-11-20', endDate: '2026-11-20' }),
    ]);
    expect(rows.map((r) => [r.employeeName, r.entries.length])).toEqual([
      ['Bilal Second', 1],
      ['Eman Employee', 2],
    ]);
  });

  it('turns entries into spans that cover the month exactly once', () => {
    const days = monthDays('2026-11');
    const segs = segments(days, [entry({}), entry({ startDate: '2026-10-28', endDate: '2026-11-01' })]);
    expect(segs.reduce((n, s) => n + s.span, 0)).toBe(days.length);
    expect(segs.slice(0, 4).map((s) => [s.kind, s.start, s.span])).toEqual([
      ['leave', '2026-11-01', 1],
      ['gap', '2026-11-02', 1],
      ['leave', '2026-11-03', 3],
      ['gap', '2026-11-06', 25],
    ]);
  });
});
