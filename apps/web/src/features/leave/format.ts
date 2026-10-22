import type { LeaveRequestDto } from '@hrm/contracts';
import { formatDateRange } from '../../lib/format';

const HALF_DAY_LABEL = { first_half: 'first half', second_half: 'second half' } as const;

/** `4 to 5 Nov 2026`, or `14 Sep 2026 · first half` for a half day (CONTENT-STYLE §8). */
export function formatLeaveDates(
  r: Pick<LeaveRequestDto, 'startDate' | 'endDate' | 'unit' | 'halfDayPart'>,
): string {
  const range = formatDateRange(r.startDate, r.endDate);
  return r.unit === 'half_day' && r.halfDayPart ? `${range} · ${HALF_DAY_LABEL[r.halfDayPart]}` : range;
}

export const halfDayLabel = (part: keyof typeof HALF_DAY_LABEL) => HALF_DAY_LABEL[part];

/** A leave quantity is negative when its decimal string starts with a minus sign (no number conversion). */
export const isNegativeQty = (qty: string) => qty.trim().startsWith('-');

/** `"9.50"` → `9.5`, `"10.00"` → `10`: the API's decimal string without trailing zeros, never via a JS number. */
export const formatQty = (qty: string) => qty.replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');

/** True for `0`, `0.00`, `-0.0`. */
export const isZeroQty = (qty: string) => /^-?0*(\.0+)?$/.test(qty.trim());

/** First and last day of a calendar year, for list filters. */
export const yearRange = (year: number) => ({ from: `${year}-01-01`, to: `${year}-12-31` });
