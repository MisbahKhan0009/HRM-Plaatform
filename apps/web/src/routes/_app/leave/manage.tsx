import { leaveRequestStatusValues } from '@hrm/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { leaveQueries } from '../../../features/leave/api';
import {
  LeaveManagePage,
  manageBalanceParams,
  manageRequestParams,
} from '../../../features/leave/pages/manage-page';
import { requireAny } from '../../../lib/auth/me';
import { todayIso } from '../../../lib/format';

const year = Number(todayIso().slice(0, 4));

export const Route = createFileRoute('/_app/leave/manage')({
  validateSearch: z.object({
    tab: z.enum(['requests', 'balances', 'ledger']).default('requests').catch('requests'),
    status: z.enum(leaveRequestStatusValues).optional().catch(undefined),
    leaveTypeId: z.uuid().optional().catch(undefined),
    employeeId: z.uuid().optional().catch(undefined),
    year: z.number().int().min(2000).max(2100).default(year).catch(year),
    page: z.number().int().min(1).default(1).catch(1),
    pageSize: z.number().int().min(1).max(100).default(25).catch(25),
  }),
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['leave.read.all']),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    if (deps.tab === 'requests')
      void context.queryClient.prefetchQuery(leaveQueries.requests(manageRequestParams(deps)));
    if (deps.tab === 'balances')
      void context.queryClient.prefetchQuery(leaveQueries.balances(manageBalanceParams(deps)));
  },
  component: LeaveManagePage,
});
