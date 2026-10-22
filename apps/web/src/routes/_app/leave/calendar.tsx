import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { leaveQueries } from '../../../features/leave/api';
import { isMonth, monthBounds } from '../../../features/leave/calendar';
import { LeaveCalendarPage } from '../../../features/leave/pages/calendar-page';
import { requireAny } from '../../../lib/auth/me';
import { todayIso } from '../../../lib/format';

const thisMonth = () => todayIso().slice(0, 7);

export const Route = createFileRoute('/_app/leave/calendar')({
  validateSearch: z.object({
    month: z
      .string()
      .refine(isMonth)
      .default(thisMonth)
      .catch(() => thisMonth()),
  }),
  beforeLoad: ({ context }) =>
    requireAny(context.queryClient, ['leave.read.team', 'leave.read.all', 'leave.request.own']),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    const { from, to } = monthBounds(deps.month);
    void context.queryClient.prefetchQuery(leaveQueries.calendar(from, to));
  },
  component: LeaveCalendarPage,
});
