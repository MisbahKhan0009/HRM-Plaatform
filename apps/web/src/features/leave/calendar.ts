import type { LeaveCalendarEntry } from '@hrm/contracts';

// Calendar arithmetic on business dates (`YYYY-MM-DD`, no zone). Display only: leave days are counted by the API.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (v: string) => MONTH.test(v);

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** First and last date of a `YYYY-MM` month. */
export function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Every date of the month in order. */
export function monthDays(month: string): string[] {
  const { from, to } = monthBounds(month);
  const out: string[] = [];
  for (let d = utc(from); iso(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(iso(d));
  return out;
}

/** `2026-11` + 1 → `2026-12`; crosses years. */
export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return iso(d).slice(0, 7);
}

/** 0 = Sunday. */
export const weekday = (date: string) => utc(date).getUTCDay();

export const covers = (e: Pick<LeaveCalendarEntry, 'startDate' | 'endDate'>, date: string) =>
  e.startDate <= date && date <= e.endDate;

export interface PersonRow {
  employeeId: string;
  employeeName: string;
  entries: LeaveCalendarEntry[];
}

/** One row per person, ordered by name (SCREEN-INVENTORY 4.4: each person a row). */
export function byPerson(entries: LeaveCalendarEntry[]): PersonRow[] {
  const rows = new Map<string, PersonRow>();
  for (const e of entries) {
    const row = rows.get(e.employeeId) ?? {
      employeeId: e.employeeId,
      employeeName: e.employeeName,
      entries: [],
    };
    row.entries.push(e);
    rows.set(e.employeeId, row);
  }
  return [...rows.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

export type Segment =
  | { kind: 'gap'; span: number; start: string }
  | { kind: 'leave'; span: number; start: string; entry: LeaveCalendarEntry };

/**
 * A person's month as consecutive cells: leave bars span their days (clipped to the month), gaps fill the rest. When
 * two entries touch the same day (two half days), the first one wins the cell.
 */
export function segments(days: string[], entries: LeaveCalendarEntry[]): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  while (i < days.length) {
    const day = days[i] as string;
    const entry = entries.find((e) => covers(e, day));
    if (entry) {
      let span = 1;
      while (i + span < days.length && covers(entry, days[i + span] as string)) span++;
      out.push({ kind: 'leave', span, start: day, entry });
      i += span;
    } else {
      const last = out.at(-1);
      if (last?.kind === 'gap') last.span++;
      else out.push({ kind: 'gap', span: 1, start: day });
      i++;
    }
  }
  return out;
}
