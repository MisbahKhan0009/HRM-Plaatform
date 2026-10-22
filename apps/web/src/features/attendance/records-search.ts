import { attendanceStatusValues } from '@hrm/contracts';
import { z } from 'zod';
import { todayIso } from '../../lib/format';
import { addDays, weekRange } from './dates';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const weekFrom = () => weekRange(todayIso()).from;
const weekTo = () => weekRange(todayIso()).to;

/**
 * Search params of the records tables (`/attendance/team`, `/attendance/records`). The range is required by the API
 * (API-STANDARDS §5) and defaults to this week; a reversed or too long range is repaired rather than sent.
 */
export const recordsSearch = z
  .object({
    from: isoDate.default(weekFrom).catch(weekFrom),
    to: isoDate.default(weekTo).catch(weekTo),
    page: z.number().int().min(1).default(1).catch(1),
    pageSize: z.number().int().min(1).max(100).default(25).catch(25),
    employeeId: z.uuid().optional().catch(undefined),
    departmentId: z.uuid().optional().catch(undefined),
    status: z.enum(attendanceStatusValues).optional().catch(undefined),
    needsReview: z.boolean().optional().catch(undefined),
  })
  .transform((s) => {
    const [from, to] = s.to < s.from ? [s.to, s.from] : [s.from, s.to];
    return { ...s, from, to: to > addDays(from, 365) ? addDays(from, 365) : to };
  });

export type RecordsSearch = z.output<typeof recordsSearch>;
