/**
 * Business-date helpers on `YYYY-MM-DD` strings. Business dates have no time zone; they are already
 * Asia/Dhaka calendar dates (NFR-LOC-003), so arithmetic is done on UTC midnight to avoid DST effects.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export type IsoDate = string;

function toEpochDay(date: IsoDate): number {
  if (!ISO_DATE.test(date)) throw new RangeError(`Invalid ISO date: ${date}`);
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid ISO date: ${date}`);
  return Math.round(ms / DAY_MS);
}

function fromEpochDay(day: number): IsoDate {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Number of calendar days from `from` to `to`, both inclusive. Returns 0 when `to` is before `from`. */
export function daysInclusive(from: IsoDate, to: IsoDate): number {
  return Math.max(0, toEpochDay(to) - toEpochDay(from) + 1);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromEpochDay(toEpochDay(date) + days);
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b;
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}

/** First and last day of a calendar month (`month` is 1–12). */
export function monthPeriod(year: number, month: number): { start: IsoDate; end: IsoDate } {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = fromEpochDay(Math.round(Date.UTC(year, month, 1) / DAY_MS) - 1);
  return { start, end };
}
