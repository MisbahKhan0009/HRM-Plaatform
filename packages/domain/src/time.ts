import { TZDate } from '@date-fns/tz';
import { addDays, daysInclusive, type IsoDate } from './dates';

/** Company time zone (X-002). Bangladesh has no daylight saving time. */
export const BUSINESS_TZ = 'Asia/Dhaka';

/** The business date (`YYYY-MM-DD`) of an instant in the given zone (CODING-STANDARDS §6). */
export function toBusinessDate(instant: Date, tz: string = BUSINESS_TZ): IsoDate {
  const d = new TZDate(instant.getTime(), tz);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The instant of a wall-clock time (`HH:MM` or `HH:MM:SS`) on a business date in the zone. */
export function zonedInstant(date: IsoDate, time: string, tz: string = BUSINESS_TZ): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh = 0, mm = 0, ss = 0] = time.split(':').map(Number);
  return new Date(new TZDate(y, m - 1, d, hh, mm, ss, tz).getTime());
}

/** Start (inclusive) and end (exclusive) instants of a business date. */
export function businessDayBounds(date: IsoDate, tz: string = BUSINESS_TZ): { start: Date; end: Date } {
  return { start: zonedInstant(date, '00:00', tz), end: zonedInstant(addDays(date, 1), '00:00', tz) };
}

/** Day of week of a business date: 0 = Sunday … 6 = Saturday (matches `work_schedules.working_days`). */
export function weekday(date: IsoDate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Every date from `from` to `to`, inclusive. */
export function eachDate(from: IsoDate, to: IsoDate): IsoDate[] {
  const n = daysInclusive(from, to);
  return Array.from({ length: n }, (_, i) => addDays(from, i));
}

/** Whole minutes between two instants (floored, never negative). */
export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
}
