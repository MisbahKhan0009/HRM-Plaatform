import { daysInclusive, type IsoDate } from '../dates';
import { Decimal } from '../money';
import { eachDate, weekday } from '../time';

export type LeaveUnit = 'day' | 'half_day';
export type HalfDayPart = 'first_half' | 'second_half';

/** A schedule in force for an employee from `from` to `to` (inclusive; `null` = open-ended). */
export interface ScheduleSpan {
  from: IsoDate;
  to: IsoDate | null;
  /** 0 = Sunday … 6 = Saturday (`work_schedules.working_days`). */
  workingDays: readonly number[];
}

export interface LeaveCountInput {
  startDate: IsoDate;
  endDate: IsoDate;
  unit: LeaveUnit;
  /** Assigned schedules; a date not covered by any span uses `defaultWorkingDays`. */
  schedules: readonly ScheduleSpan[];
  defaultWorkingDays: readonly number[];
  holidays: readonly IsoDate[];
}

export type LeaveCountResult =
  | { ok: true; units: Decimal; dates: IsoDate[] }
  | { ok: false; reason: 'INVALID_RANGE' | 'SPANS_LEAVE_YEARS' | 'HALF_DAY_RANGE' | 'NO_WORKING_DAYS' };

/** The leave year of a date: the calendar year (D-015). */
export function leaveYearOf(date: IsoDate): number {
  return Number(date.slice(0, 4));
}

/** Working days of the schedule in force on `date`. */
export function workingDaysOn(
  date: IsoDate,
  schedules: readonly ScheduleSpan[],
  defaultWorkingDays: readonly number[],
): readonly number[] {
  const span = schedules.find((s) => s.from <= date && (s.to === null || s.to >= date));
  return span ? span.workingDays : defaultWorkingDays;
}

/**
 * BUSINESS-RULES 3.1: counts working days in `[startDate, endDate]` by the schedule assigned on each date, skipping
 * holidays; a half day counts 0.5 and must be a single working date. A range across two leave years is rejected.
 */
export function countLeaveUnits(input: LeaveCountInput): LeaveCountResult {
  const { startDate, endDate, unit } = input;
  if (daysInclusive(startDate, endDate) === 0) return { ok: false, reason: 'INVALID_RANGE' };
  if (leaveYearOf(startDate) !== leaveYearOf(endDate)) return { ok: false, reason: 'SPANS_LEAVE_YEARS' };
  if (unit === 'half_day' && startDate !== endDate) return { ok: false, reason: 'HALF_DAY_RANGE' };
  const holidays = new Set(input.holidays);
  const dates = eachDate(startDate, endDate).filter(
    (d) =>
      workingDaysOn(d, input.schedules, input.defaultWorkingDays).includes(weekday(d)) && !holidays.has(d),
  );
  if (dates.length === 0) return { ok: false, reason: 'NO_WORKING_DAYS' };
  return { ok: true, units: unit === 'half_day' ? new Decimal('0.5') : new Decimal(dates.length), dates };
}

export interface LeaveSlot {
  startDate: IsoDate;
  endDate: IsoDate;
  unit: LeaveUnit;
  halfDayPart: HalfDayPart | null;
}

/**
 * BUSINESS-RULES 3.1: two active requests conflict when their ranges share a date, except a `first_half` and a
 * `second_half` on the same date.
 */
export function leaveSlotsConflict(a: LeaveSlot, b: LeaveSlot): boolean {
  if (a.startDate > b.endDate || b.startDate > a.endDate) return false;
  if (a.unit === 'half_day' && b.unit === 'half_day' && a.halfDayPart !== b.halfDayPart) return false;
  return true;
}
