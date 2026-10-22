// Display formats from CONTENT-STYLE §8, always in the company time zone. Money stays a decimal string: digits are
// grouped as text, never converted to a JS number (ADR-0006).
const TZ = 'Asia/Dhaka';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const shortDateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const timeFmt = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: TZ,
});
const dateTimeDateFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: TZ,
});

const asUtcDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

/** `2026-10-22` → `22 Oct 2026` (business dates have no zone). */
export const formatDate = (iso: string) => dateFmt.format(asUtcDate(iso));
export const formatShortDate = (iso: string) => shortDateFmt.format(asUtcDate(iso));
export const formatMonth = (year: number, month: number) =>
  monthFmt.format(new Date(Date.UTC(year, month - 1, 1)));

/** `9:12 am` in Asia/Dhaka. */
export const formatTime = (instant: string | Date) =>
  timeFmt.format(new Date(instant)).replace('AM', 'am').replace('PM', 'pm');

/** `22 Oct 2026, 9:12 am` in Asia/Dhaka. */
export const formatDateTime = (instant: string | Date) =>
  `${dateTimeDateFmt.format(new Date(instant))}, ${formatTime(instant)}`;

/** `3 to 5 Nov 2026` or `30 Oct to 2 Nov 2026`. */
export function formatDateRange(from: string, to: string) {
  if (from === to) return formatDate(from);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  if (sameMonth) return `${Number(from.slice(8, 10))} to ${formatDate(to)}`;
  return `${sameYear ? formatShortDate(from) : formatDate(from)} to ${formatDate(to)}`;
}

/** Minutes → `8h 05m`. */
export const formatDuration = (minutes: number) =>
  `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;

/** `"45000.00"` → `৳ 45,000.00` (thin space after the symbol). */
export function formatMoney(amount: string) {
  const negative = amount.startsWith('-');
  const [intPart = '0', frac = '00'] = (negative ? amount.slice(1) : amount).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}৳ ${grouped}.${frac.padEnd(2, '0').slice(0, 2)}`;
}

/** Leave days: decimals only for halves (`1 day`, `0.5 day`, `2.5 days`). */
export function formatDays(units: string) {
  const clean = units.replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
  return `${clean} ${clean === '1' || clean === '0.5' ? 'day' : 'days'}`;
}

/** Relative time for lists under 7 days, else the date. */
export function formatRelative(instant: string, now = new Date()) {
  const diff = Math.round((now.getTime() - new Date(instant).getTime()) / 60_000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff} min ago`;
  const hours = Math.floor(diff / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return dateTimeDateFmt.format(new Date(instant));
}

/** Today's business date in Asia/Dhaka. */
export function todayIso(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
