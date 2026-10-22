import { IsoDateSchema } from '@hrm/contracts';
import { z } from 'zod';
import { todayIso } from '../../lib/format';

/** Search-param schemas shared by report routes (TABLES-AND-LISTS §3): invalid values fall back to defaults. */
export const paging = {
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(25).catch(25),
};

/** Claim statuses the reimbursements report accepts: drafts never appear (API-CATALOGUE §12). */
export const REPORTED_CLAIM_STATUSES = [
  'submitted',
  'approved',
  'rejected',
  'withdrawn',
  'included',
  'paid',
] as const;

/** First and last day of the current month in Asia/Dhaka: the default range of date-bound reports. */
export function currentMonth(): { from: string; to: string } {
  const today = todayIso();
  const [y, m] = today.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-${String(last).padStart(2, '0')}` };
}

export const thisYear = Number(todayIso().slice(0, 4));

/** Required `from`/`to`, defaulting to the current month (TABLES-AND-LISTS §4). Order and span: API-STANDARDS §5. */
export const dateRange = () => {
  const month = currentMonth();
  return {
    from: IsoDateSchema.default(month.from).catch(month.from),
    to: IsoDateSchema.default(month.to).catch(month.to),
  };
};
