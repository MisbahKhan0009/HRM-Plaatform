import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import { weekday } from '../time';
import { countLeaveUnits, type LeaveCountInput, leaveSlotsConflict } from './days';

const SUN_THU = [0, 1, 2, 3, 4];
const input = (o: Partial<LeaveCountInput>): LeaveCountInput => ({
  startDate: '2026-11-01',
  endDate: '2026-11-01',
  unit: 'day',
  schedules: [],
  defaultWorkingDays: SUN_THU,
  holidays: [],
  ...o,
});

describe('countLeaveUnits (BUSINESS-RULES 3.1)', () => {
  it.each([
    // [rule, start, end, unit, holidays, expected units or failure]
    ['3.2 example: 1 to 9 Nov, Sun–Thu, no holidays', '2026-11-01', '2026-11-09', 'day', [], '7'],
    ['skips Friday and Saturday', '2026-11-05', '2026-11-08', 'day', [], '2'],
    ['skips a holiday inside the range', '2026-12-14', '2026-12-17', 'day', ['2026-12-16'], '3'],
    ['half day on a working date is 0.5', '2026-11-03', '2026-11-03', 'half_day', [], '0.5'],
    ['a weekend-only range has no working days', '2026-11-06', '2026-11-07', 'day', [], 'NO_WORKING_DAYS'],
    [
      'a half day on a holiday has no working days',
      '2026-12-16',
      '2026-12-16',
      'half_day',
      ['2026-12-16'],
      'NO_WORKING_DAYS',
    ],
    [
      '3.2 example: 30 Dec 2026 to 6 Jan 2027 spans two leave years',
      '2026-12-30',
      '2027-01-06',
      'day',
      [],
      'SPANS_LEAVE_YEARS',
    ],
    ['a half day must be a single date', '2026-11-03', '2026-11-04', 'half_day', [], 'HALF_DAY_RANGE'],
    ['end before start is invalid', '2026-11-04', '2026-11-03', 'day', [], 'INVALID_RANGE'],
  ] as const)('%s', (_rule, startDate, endDate, unit, holidays, expected) => {
    const r = countLeaveUnits(input({ startDate, endDate, unit, holidays }));
    if (r.ok) expect(r.units.toString()).toBe(expected);
    else expect(r.reason).toBe(expected);
  });

  it('uses the schedule assigned on each date, falling back to the default', () => {
    // Sat–Wed schedule from 8 Nov: 8 (Sun), 9, 10, 11 (Wed) and 14 (Sat) count; 12 and 13 (Thu, Fri) do not.
    const r = countLeaveUnits(
      input({
        startDate: '2026-11-05',
        endDate: '2026-11-14',
        schedules: [{ from: '2026-11-08', to: null, workingDays: [6, 0, 1, 2, 3] }],
      }),
    );
    // 5 Nov (Thu, default schedule) + 8, 9, 10, 11, 14 Nov = 6.
    expect(r.ok && r.units.toString()).toBe('6');
  });

  it('property: units equal the count of working non-holiday dates; a half day is 0.5', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 330 }),
        fc.integer({ min: 0, max: 30 }),
        fc.uniqueArray(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 7 }),
        fc.uniqueArray(fc.integer({ min: 0, max: 364 }), { maxLength: 20 }),
        (offset, length, workingDays, holidayOffsets) => {
          const startDate = addDays('2026-01-01', offset);
          const endDate = addDays(startDate, length);
          const holidays = holidayOffsets.map((o) => addDays('2026-01-01', o));
          const r = countLeaveUnits(input({ startDate, endDate, defaultWorkingDays: workingDays, holidays }));
          let expected = 0;
          for (let i = 0; i <= length; i++) {
            const d = addDays(startDate, i);
            if (workingDays.includes(weekday(d)) && !holidays.includes(d)) expected += 1;
          }
          if (endDate.slice(0, 4) !== '2026') return !r.ok && r.reason === 'SPANS_LEAVE_YEARS';
          if (expected === 0) return !r.ok && r.reason === 'NO_WORKING_DAYS';
          const half = countLeaveUnits(
            input({
              startDate,
              endDate: startDate,
              unit: 'half_day',
              defaultWorkingDays: workingDays,
              holidays,
            }),
          );
          const startWorks = workingDays.includes(weekday(startDate)) && !holidays.includes(startDate);
          return (
            r.ok &&
            r.units.eq(expected) &&
            (startWorks ? half.ok && half.units.eq(0.5) : !half.ok && half.reason === 'NO_WORKING_DAYS')
          );
        },
      ),
    );
  });
});

describe('leaveSlotsConflict (BUSINESS-RULES 3.1 overlap rule)', () => {
  const day = (startDate: string, endDate = startDate) => ({
    startDate,
    endDate,
    unit: 'day' as const,
    halfDayPart: null,
  });
  const half = (date: string, part: 'first_half' | 'second_half') => ({
    startDate: date,
    endDate: date,
    unit: 'half_day' as const,
    halfDayPart: part,
  });

  it.each([
    [
      'ranges sharing a date conflict',
      day('2026-11-01', '2026-11-03'),
      day('2026-11-03', '2026-11-05'),
      true,
    ],
    ['adjacent ranges do not conflict', day('2026-11-01', '2026-11-02'), day('2026-11-03'), false],
    [
      'first and second half of one date do not conflict',
      half('2026-11-03', 'first_half'),
      half('2026-11-03', 'second_half'),
      false,
    ],
    [
      'two first halves of one date conflict',
      half('2026-11-03', 'first_half'),
      half('2026-11-03', 'first_half'),
      true,
    ],
    [
      'a half day inside a full-day range conflicts',
      half('2026-11-03', 'second_half'),
      day('2026-11-01', '2026-11-04'),
      true,
    ],
  ])('%s', (_rule, a, b, expected) => {
    expect(leaveSlotsConflict(a, b)).toBe(expected);
    expect(leaveSlotsConflict(b, a)).toBe(expected);
  });
});
