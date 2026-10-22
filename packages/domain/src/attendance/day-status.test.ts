import { attendanceStatusValues } from '@hrm/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { zonedInstant } from '../time';
import {
  computeAttendanceDay,
  type DayEvent,
  type DayInput,
  type DaySchedule,
  effectivePunches,
  isEmployedOn,
} from './day-status';

// Worked example schedule (BUSINESS-RULES 2.5): Sun–Thu, core 10:00–16:00, 480 min, 60 min break.
const schedule: DaySchedule = {
  workingDays: [0, 1, 2, 3, 4],
  coreStart: '10:00',
  coreEnd: '16:00',
  minDailyMinutes: 480,
  breakMinutes: 60,
  timezone: 'Asia/Dhaka',
};
const employment = { status: 'active', joiningDate: '2025-01-01', separationDate: null };

let seq = 0;
const at = (date: string, time: string) => zonedInstant(date, time);
const ev = (type: DayEvent['type'], occurredAt: Date, extra: Partial<DayEvent> = {}): DayEvent => {
  seq += 1;
  return {
    id: `00000000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    type,
    occurredAt,
    recordedAt: extra.recordedAt ?? occurredAt,
    checkInAt: null,
    checkOutAt: null,
    ...extra,
  };
};
const punches = (date: string, ...times: string[]) =>
  times.map((t, i) => {
    const [d, hm] = t.includes(' ') ? (t.split(' ') as [string, string]) : [date, t];
    return ev(i % 2 === 0 ? 'check_in' : 'check_out', at(d, hm));
  });
const day = (workDate: string, events: DayEvent[], over: Partial<DayInput> = {}): DayInput => ({
  workDate,
  employment,
  schedule,
  isHoliday: false,
  leave: 'none',
  events,
  ...over,
});

describe('computeAttendanceDay: worked example (BUSINESS-RULES 2.5)', () => {
  const cases: [string, string, string[], { worked: number; late: number; status: string }][] = [
    ['Sun', '2026-11-01', ['09:05', '18:10'], { worked: 485, late: 0, status: 'present' }],
    ['Mon', '2026-11-02', ['10:40', '19:00'], { worked: 440, late: 40, status: 'short_hours' }],
    ['Tue', '2026-11-03', ['08:00', '15:30'], { worked: 390, late: 0, status: 'short_hours' }],
    ['Wed', '2026-11-04', ['09:30'], { worked: 0, late: 0, status: 'missing_punch' }],
    ['Thu', '2026-11-05', ['07:00', '15:00', '15:30', '17:00'], { worked: 510, late: 0, status: 'present' }],
    ['Fri', '2026-11-06', [], { worked: 0, late: 0, status: 'weekend' }],
  ];

  it.each(cases)('%s %s', (_name, date, times, expected) => {
    const r = computeAttendanceDay(day(date, punches(date, ...times)));
    expect({ worked: r.workedMinutes, late: r.lateMinutes, status: r.status }).toEqual(expected);
  });

  it('reports early leave without changing a short-hours status', () => {
    const r = computeAttendanceDay(day('2026-11-03', punches('2026-11-03', '08:00', '15:30')));
    expect(r.earlyLeaveMinutes).toBe(30);
  });
});

describe('computeAttendanceDay: status precedence (BUSINESS-RULES 2.3)', () => {
  const full = punches('2026-11-01', '09:00', '18:30');
  const table: [string, Partial<DayInput>, DayEvent[], string][] = [
    ['before joining', { employment: { ...employment, joiningDate: '2026-11-02' } }, full, 'not_employed'],
    [
      'after separation',
      { employment: { ...employment, separationDate: '2026-10-31' } },
      full,
      'not_employed',
    ],
    ['draft employee', { employment: { ...employment, status: 'draft' } }, full, 'not_employed'],
    ['holiday', { isHoliday: true }, full, 'holiday'],
    ['full-day leave', { leave: 'full' }, [], 'on_leave'],
    ['no events', {}, [], 'absent'],
    ['holiday wins over leave', { isHoliday: true, leave: 'full' }, [], 'holiday'],
  ];
  it.each(table)('%s', (_name, over, events, status) => {
    expect(computeAttendanceDay(day('2026-11-01', events, over)).status).toBe(status);
  });

  it('keeps weekend work visible', () => {
    const r = computeAttendanceDay(day('2026-11-06', punches('2026-11-06', '10:00', '14:00')));
    expect(r).toMatchObject({ status: 'weekend', workedMinutes: 180, lateMinutes: 0 });
  });

  it('flags missed core when the minimum is met outside the core window', () => {
    const r = computeAttendanceDay(day('2026-11-01', punches('2026-11-01', '10:30', '20:00')));
    expect(r).toMatchObject({ status: 'missed_core', workedMinutes: 510, lateMinutes: 30 });
  });

  it('halves the minimum and skips the core rule with a half-day leave', () => {
    const r = computeAttendanceDay(
      day('2026-11-01', punches('2026-11-01', '13:00', '18:00'), { leave: 'half' }),
    );
    expect(r).toMatchObject({ status: 'present', workedMinutes: 240, lateMinutes: 0 });
    const short = computeAttendanceDay(
      day('2026-11-01', punches('2026-11-01', '13:00', '17:59'), { leave: 'half' }),
    );
    expect(short.status).toBe('short_hours');
  });

  it('deducts the break only when the span exceeds it', () => {
    const r = computeAttendanceDay(day('2026-11-01', punches('2026-11-01', '10:00', '10:45')));
    expect(r).toMatchObject({ workedMinutes: 0, status: 'short_hours' });
  });

  it('flags a check-out after midnight for review', () => {
    const r = computeAttendanceDay(day('2026-11-01', punches('2026-11-01', '09:00', '2026-11-02 00:30')));
    expect(r).toMatchObject({ needsReview: true, status: 'present', workedMinutes: 870 });
  });
});

describe('effectivePunches: overrides (BUSINESS-RULES 2.2)', () => {
  it('fills a missing check-out from a correction and keeps the web check-in', () => {
    const web = punches('2026-11-04', '09:30');
    const correction = ev('correction', at('2026-11-04', '18:30'), {
      checkOutAt: at('2026-11-04', '18:30'),
      recordedAt: at('2026-11-05', '09:00'),
    });
    const r = computeAttendanceDay(day('2026-11-04', [...web, correction]));
    expect(r).toMatchObject({ status: 'present', workedMinutes: 480, hasCorrection: true });
    expect(r.firstInAt).toEqual(at('2026-11-04', '09:30'));
  });

  it('uses the latest override by recorded time', () => {
    const older = ev('manual_entry', at('2026-11-01', '09:00'), {
      checkInAt: at('2026-11-01', '09:00'),
      checkOutAt: at('2026-11-01', '18:00'),
      recordedAt: at('2026-11-02', '09:00'),
    });
    const newer = ev('correction', at('2026-11-01', '11:00'), {
      checkInAt: at('2026-11-01', '11:00'),
      recordedAt: at('2026-11-03', '09:00'),
    });
    const r = effectivePunches([newer, older]);
    expect(r.pairs).toEqual([{ in: at('2026-11-01', '11:00'), out: null }]);
    expect(r.incomplete).toBe(true);
  });

  it('collapses several web pairs into one pair under an override', () => {
    const web = punches('2026-11-05', '09:00', '12:00', '13:00');
    const correction = ev('correction', at('2026-11-05', '18:00'), {
      checkOutAt: at('2026-11-05', '18:00'),
      recordedAt: at('2026-11-06', '09:00'),
    });
    expect(effectivePunches([...web, correction]).spanMinutes).toBe(540);
  });

  it('treats a check-out that is not after the check-in as missing', () => {
    const web = punches('2026-11-05', '09:00', '12:00');
    const correction = ev('correction', at('2026-11-05', '13:00'), {
      checkInAt: at('2026-11-05', '13:00'),
      recordedAt: at('2026-11-06', '09:00'),
    });
    expect(computeAttendanceDay(day('2026-11-05', [...web, correction])).status).toBe('missing_punch');
  });
});

describe('isEmployedOn', () => {
  it('includes the joining and separation dates', () => {
    const e = { status: 'separated', joiningDate: '2026-01-10', separationDate: '2026-03-31' };
    expect([
      isEmployedOn(e, '2026-01-09'),
      isEmployedOn(e, '2026-01-10'),
      isEmployedOn(e, '2026-03-31'),
    ]).toEqual([false, true, true]);
    expect(isEmployedOn(e, '2026-04-01')).toBe(false);
  });
});

// Properties ---------------------------------------------------------------------------------------------------------

const DATE = '2026-11-01'; // Sunday, a working day
const dayStart = at(DATE, '00:00').getTime();
const minute = 60_000;

const scheduleArb = fc.record({
  workingDays: fc.uniqueArray(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 7 }),
  coreStart: fc.integer({ min: 6 * 60, max: 11 * 60 }).map(hm),
  coreEnd: fc.integer({ min: 12 * 60, max: 18 * 60 }).map(hm),
  minDailyMinutes: fc.integer({ min: 0, max: 720 }),
  breakMinutes: fc.integer({ min: 0, max: 120 }),
  timezone: fc.constant('Asia/Dhaka'),
});

function hm(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const eventArb = fc
  .record({
    type: fc.constantFrom<DayEvent['type']>('check_in', 'check_out', 'check_in', 'check_out', 'correction'),
    minuteOfDay: fc.integer({ min: 0, max: 26 * 60 }),
    seconds: fc.integer({ min: 0, max: 59 }),
    recordedOffset: fc.integer({ min: 0, max: 3 * 24 * 60 }),
    inAt: fc.option(fc.integer({ min: 5 * 60, max: 14 * 60 }), { nil: null }),
    outAt: fc.option(fc.integer({ min: 12 * 60, max: 25 * 60 }), { nil: null }),
  })
  .map((r) => {
    const occurredAt = new Date(dayStart + r.minuteOfDay * minute + r.seconds * 1000);
    const isOverride = r.type === 'correction';
    const inAt = isOverride && r.inAt !== null ? new Date(dayStart + r.inAt * minute) : null;
    const outAt =
      isOverride && (r.outAt !== null || inAt === null)
        ? new Date(dayStart + (r.outAt ?? 18 * 60) * minute)
        : null;
    return ev(r.type, occurredAt, {
      recordedAt: new Date(occurredAt.getTime() + r.recordedOffset * minute),
      checkInAt: inAt,
      checkOutAt: outAt,
    });
  });

const inputArb = fc.record({
  schedule: scheduleArb,
  isHoliday: fc.boolean(),
  leave: fc.constantFrom<DayInput['leave']>('none', 'half', 'full'),
  events: fc.array(eventArb, { maxLength: 8 }),
});

describe('computeAttendanceDay: properties', () => {
  it('always returns a catalogued status and non-negative minutes', () => {
    fc.assert(
      fc.property(inputArb, (i) => {
        const r = computeAttendanceDay(day(DATE, i.events, i));
        expect(attendanceStatusValues).toContain(r.status);
        expect(r.workedMinutes).toBeGreaterThanOrEqual(0);
        expect(r.lateMinutes).toBeGreaterThanOrEqual(0);
        expect(r.earlyLeaveMinutes).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(r.workedMinutes)).toBe(true);
      }),
    );
  });

  it('does not depend on the order events are read in', () => {
    fc.assert(
      fc.property(inputArb, fc.nat(), (i, k) => {
        const cut = i.events.length ? k % i.events.length : 0;
        const shuffled = [...i.events.slice(cut), ...i.events.slice(0, cut)].reverse();
        expect(computeAttendanceDay(day(DATE, shuffled, i))).toEqual(
          computeAttendanceDay(day(DATE, i.events, i)),
        );
      }),
    );
  });

  it('worked minutes never exceed the span of effective pairs', () => {
    fc.assert(
      fc.property(inputArb, (i) => {
        const r = computeAttendanceDay(day(DATE, i.events, i));
        expect(r.workedMinutes).toBeLessThanOrEqual(effectivePunches(i.events).spanMinutes);
      }),
    );
  });

  it('present means the minimum is met and, without a half-day leave, the core window is covered', () => {
    fc.assert(
      fc.property(inputArb, (i) => {
        const r = computeAttendanceDay(day(DATE, i.events, i));
        if (r.status !== 'present') return;
        const required = i.leave === 'half' ? i.schedule.minDailyMinutes / 2 : i.schedule.minDailyMinutes;
        expect(r.workedMinutes).toBeGreaterThanOrEqual(required);
        if (i.leave === 'none') {
          expect(r.lateMinutes).toBe(0);
          expect(r.earlyLeaveMinutes).toBe(0);
        }
      }),
    );
  });

  it('reports a late arrival in minutes and evaluates it only through the core rule (D-010)', () => {
    fc.assert(
      fc.property(scheduleArb, fc.integer({ min: 1, max: 60 }), (s, lateBy) => {
        const sched = { ...s, workingDays: [0], minDailyMinutes: 0, breakMinutes: 0 };
        const start = at(DATE, sched.coreStart).getTime();
        const end = at(DATE, sched.coreEnd).getTime();
        const events = [
          ev('check_in', new Date(start + lateBy * minute)),
          ev('check_out', new Date(end + minute)),
        ];
        const r = computeAttendanceDay(day(DATE, events, { schedule: sched }));
        expect(r.status).toBe('missed_core');
        expect(r.lateMinutes).toBe(lateBy);
      }),
    );
  });

  it('a date outside employment is always not_employed', () => {
    fc.assert(
      fc.property(inputArb, (i) => {
        const r = computeAttendanceDay(
          day(DATE, i.events, { ...i, employment: { ...employment, joiningDate: '2026-11-02' } }),
        );
        expect(r.status).toBe('not_employed');
      }),
    );
  });
});
