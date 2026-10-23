import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { AttendanceReportPage } from '../../../features/reports/AttendanceReportPage';
import { dateRange, paging } from '../../../features/reports/search';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/reports/attendance')({
  validateSearch: z.object({ ...paging, ...dateRange(), departmentId: z.uuid().optional().catch(undefined) }),
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['report.hr', 'report.team']),
  component: AttendanceReportPage,
});
