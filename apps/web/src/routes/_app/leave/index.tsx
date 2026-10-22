import { leaveRequestStatusValues } from '@hrm/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { leaveQueries } from '../../../features/leave/api';
import { MyLeavePage, myRequestParams, thisLeaveYear } from '../../../features/leave/pages/my-leave-page';
import { requireAny } from '../../../lib/auth/me';

const year = thisLeaveYear();

export const Route = createFileRoute('/_app/leave/')({
  validateSearch: z.object({
    year: z.number().int().min(2000).max(2100).default(year).catch(year),
    status: z.enum(leaveRequestStatusValues).optional().catch(undefined),
    page: z.number().int().min(1).default(1).catch(1),
    pageSize: z.number().int().min(1).max(100).default(25).catch(25),
  }),
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['leave.request.own']),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    const employeeId = context.me.employee?.id;
    void context.queryClient.prefetchQuery(leaveQueries.myBalances(deps.year));
    if (employeeId)
      void context.queryClient.prefetchQuery(leaveQueries.requests(myRequestParams(employeeId, deps)));
  },
  component: MyLeavePage,
});
