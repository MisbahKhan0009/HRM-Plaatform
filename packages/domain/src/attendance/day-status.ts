import { TZDate } from '@date-fns/tz';
import type { AttendanceEventType, AttendanceStatus } from '@hrm/contracts';
import type { IsoDate } from '../dates';
import { BUSINESS_TZ, minutesBetween, toBusinessDate, weekday, zonedInstant } from '../time';

/** One attendance event of a day, as stored (`attendance_events`). */
export interface DayEvent {
  id: string;
  type: AttendanceEventType;
  occurredAt: Date;
  recordedAt: Date;
  checkInAt: Date | null;
  checkOutAt: Date | null;
}

/** The schedule that applies to the day: the employee's assignment, else the company default. */
export interface DaySchedule {
  workingDays: readonly number[];
  /** Local wall-clock times `HH:MM[:SS]` in `timezone`. */
  coreStart: string;
  coreEnd: string;
  minDailyMinutes: number;
  breakMinutes: number;
  timezone: string;
}

export interface DayEmployment {
  status: string;
  joiningDate: IsoDate | null;
  separationDate: IsoDate | null;
}

/** Approved leave covering the date: none, a half day, or a full day (two halves count as a full day). */
export type DayLeave = 'none' | 'half' | 'full';

export interface DayInput {
  workDate: IsoDate;
  employment: DayEmployment;
  schedule: DaySchedule;
  isHoliday: boolean;
  leave: DayLeave;
  events: readonly DayEvent[];
}

export interface PunchPair {
  in: Date;
  out: Date | null;
}

export interface EffectivePunches {
  /** Effective pairs in time order; `in` is null only when an override asserts a check-out with no check-in. */
  pairs: { in: Date | null; out: Date | null }[];
  firstInAt: Date | null;
  lastOutAt: Date | null;
  /** Sum of complete pairs in whole minutes, floored per pair. */
  spanMinutes: number;
  /** A pair lacks a check-in or a check-out. */
  incomplete: boolean;
}

export interface DayResult {
  status: AttendanceStatus;
  firstInAt: Date | null;
  lastOutAt: Date | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  /** A web check-out on a later business date than the work date (D-011). */
  needsReview: boolean;
  /** A correction event exists (BUSINESS-RULES 2.4). */
  hasCorrection: boolean;
}

const byTime = (a: { at: number; id: string }, b: { at: number; id: string }) =>
  a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Pairs web punches in time order: each check-in with the next event when that is a check-out (BUSINESS-RULES 2.2.2). */
export function pairWebPunches(events: readonly DayEvent[]): PunchPair[] {
  const web = events
    .filter((e) => e.type === 'check_in' || e.type === 'check_out')
    .map((e) => ({ at: e.occurredAt.getTime(), id: e.id, e }))
    .sort(byTime);
  const pairs: PunchPair[] = [];
  web.forEach((cur, i) => {
    if (cur.e.type !== 'check_in') return;
    const next = web[i + 1];
    pairs.push({ in: cur.e.occurredAt, out: next?.e.type === 'check_out' ? next.e.occurredAt : null });
  });
  return pairs;
}

/** The latest manual entry or correction by `recorded_at` (BUSINESS-RULES 2.2.1), or null. */
export function latestOverride(events: readonly DayEvent[]): DayEvent | null {
  let best: DayEvent | null = null;
  for (const e of events) {
    if (e.type !== 'manual_entry' && e.type !== 'correction') continue;
    if (
      !best ||
      byTime({ at: e.recordedAt.getTime(), id: e.id }, { at: best.recordedAt.getTime(), id: best.id }) > 0
    )
      best = e;
  }
  return best;
}

/**
 * Effective punches for one employee and work date (BUSINESS-RULES 2.2). Without an override, web punches are paired.
 * With one, the day becomes a single pair: the override's check-in (else the earliest web check-in) and its check-out
 * (else the check-out of the last web pair, which is null when that pair is open). A pair whose check-out is not after
 * its check-in counts as incomplete. Original events are never changed (FR-ATT-008).
 */
export function effectivePunches(events: readonly DayEvent[]): EffectivePunches {
  const web = pairWebPunches(events);
  const override = latestOverride(events);
  let pairs: { in: Date | null; out: Date | null }[];
  if (override) {
    const webIn = web[0]?.in ?? null;
    const webOut = web.length ? (web[web.length - 1]?.out ?? null) : null;
    pairs = [{ in: override.checkInAt ?? webIn, out: override.checkOutAt ?? webOut }];
  } else {
    pairs = web;
  }
  pairs = pairs.map((p) =>
    p.in && p.out && p.out.getTime() <= p.in.getTime() ? { in: p.in, out: null } : p,
  );

  let firstInAt: Date | null = null;
  let lastOutAt: Date | null = null;
  let spanMinutes = 0;
  let incomplete = false;
  for (const p of pairs) {
    if (p.in && (!firstInAt || p.in < firstInAt)) firstInAt = p.in;
    if (p.out && (!lastOutAt || p.out > lastOutAt)) lastOutAt = p.out;
    if (p.in && p.out) spanMinutes += minutesBetween(p.in, p.out);
    else incomplete = true;
  }
  return { pairs, firstInAt, lastOutAt, spanMinutes, incomplete };
}

/** Rule 1 of BUSINESS-RULES 2.3. */
export function isEmployedOn(employment: DayEmployment, date: IsoDate): boolean {
  if (employment.status === 'draft' || employment.status === 'preboarding') return false;
  if (!employment.joiningDate || date < employment.joiningDate) return false;
  return !(employment.separationDate && date > employment.separationDate);
}

/**
 * Status and minutes of one attendance day (BUSINESS-RULES 2.3, D-010). Rules are evaluated in order and the first
 * match wins; punches are always summarised so weekend and holiday work stays visible. Lateness and early leave are
 * reported for working days only and never change the status (D-010). The `attendance.close_day` SQL mirrors this
 * function (JOBS-AND-OUTBOX §5); change both together.
 */
export function computeAttendanceDay(input: DayInput): DayResult {
  const { workDate, schedule, events } = input;
  const punches = effectivePunches(events);
  const workedMinutes =
    punches.spanMinutes > schedule.breakMinutes ? punches.spanMinutes - schedule.breakMinutes : 0;
  const needsReview = events.some(
    (e) => e.type === 'check_out' && toBusinessDate(e.occurredAt, schedule.timezone) > workDate,
  );
  const hasCorrection = events.some((e) => e.type === 'correction');
  const base = {
    firstInAt: punches.firstInAt,
    lastOutAt: punches.lastOutAt,
    workedMinutes,
    needsReview,
    hasCorrection,
  };
  const off = (status: AttendanceStatus): DayResult => ({
    ...base,
    status,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
  });

  if (!isEmployedOn(input.employment, workDate)) return off('not_employed');
  if (!schedule.workingDays.includes(weekday(workDate))) return off('weekend');
  if (input.isHoliday) return off('holiday');
  if (input.leave === 'full') return off('on_leave');

  const half = input.leave === 'half';
  const coreStart = zonedInstant(workDate, schedule.coreStart, schedule.timezone);
  const coreEnd = zonedInstant(workDate, schedule.coreEnd, schedule.timezone);
  // A half-day leave skips the core-window rule (BUSINESS-RULES 2.3), so lateness is not reported either.
  const lateMinutes = !half && punches.firstInAt ? minutesBetween(coreStart, punches.firstInAt) : 0;
  const earlyLeaveMinutes = !half && punches.lastOutAt ? minutesBetween(punches.lastOutAt, coreEnd) : 0;
  const result = (status: AttendanceStatus): DayResult => ({
    ...base,
    status,
    lateMinutes,
    earlyLeaveMinutes,
  });

  if (events.length === 0) return result('absent');
  if (punches.incomplete || !punches.firstInAt) return result('missing_punch');
  // Compare doubled values so half of an odd minimum needs no rounding.
  if (workedMinutes * (half ? 2 : 1) < schedule.minDailyMinutes) return result('short_hours');
  if (!half && punches.lastOutAt && (punches.firstInAt > coreStart || punches.lastOutAt < coreEnd))
    return result('missed_core');
  return result('present');
}

/** Wall-clock `HH:MM` of an instant in the zone, for messages and display. */
export function localTimeOfDay(instant: Date, tz: string = BUSINESS_TZ): string {
  const d = new TZDate(instant.getTime(), tz);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
