// Calendar arithmetic on business dates (`YYYY-MM-DD`, no zone) and the Asia/Dhaka wall clock. Dhaka has had no
// daylight saving since 2009, so a wall-clock time converts with a fixed +06:00 offset.
const DHAKA_OFFSET = '+06:00';

const toUtc = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(iso: string, days: number) {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** 0 = Sunday … 6 = Saturday. */
export const weekday = (iso: string) => toUtc(iso).getUTCDay();

/** Sunday to Saturday around `today` (the Sun–Thu working week starts on Sunday, D-005). */
export function weekRange(today: string) {
  const from = addDays(today, -weekday(today));
  return { from, to: addDays(from, 6) };
}

export const monthOf = (iso: string) => iso.slice(0, 7);

export function shiftMonth(month: string, by: number) {
  const [y = 1970, m = 1] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export function daysInMonth(month: string) {
  const [y = 1970, m = 1] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The month's dates, up to `today` when the month is the current one (the API rejects `to < from`). */
export function monthRange(month: string, today: string) {
  const from = `${month}-01`;
  const last = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  return { from, to: last < today ? last : today };
}

/** `2026-10-21` + `18:05` (Asia/Dhaka) → ISO instant in UTC. */
export const dhakaInstant = (date: string, time: string) =>
  new Date(`${date}T${time}:00${DHAKA_OFFSET}`).toISOString();

const hhmm = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Dhaka',
});

/** ISO instant → `HH:mm` on the Asia/Dhaka clock (for time inputs). */
export const dhakaTime = (instant: string) => hhmm.format(new Date(instant));

/**
 * Proposed times for a correction: a check-out at or before the check-in time is the next morning (an overnight
 * shift, BUSINESS-RULES 2.1).
 */
export function proposedInstants(workDate: string, checkIn: string, checkOut: string) {
  const overnight = Boolean(checkIn && checkOut && checkOut <= checkIn);
  return {
    proposedCheckInAt: checkIn ? dhakaInstant(workDate, checkIn) : null,
    proposedCheckOutAt: checkOut ? dhakaInstant(overnight ? addDays(workDate, 1) : workDate, checkOut) : null,
  };
}
