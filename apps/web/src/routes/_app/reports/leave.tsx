import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { LeaveReportPage } from '../../../features/reports/LeaveReportPage';
import { paging, thisYear } from '../../../features/reports/search';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/reports/leave')({
  validateSearch: z.object({
    ...paging,
    year: z.number().int().min(2000).max(2100).default(thisYear).catch(thisYear),
    leaveTypeId: z.uuid().optional().catch(undefined),
    departmentId: z.uuid().optional().catch(undefined),
  }),
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['report.hr', 'report.team']),
  component: LeaveReportPage,
});
