import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ReimbursementsReportPage } from '../../../features/reports/ReimbursementsReportPage';
import { dateRange, paging, REPORTED_CLAIM_STATUSES } from '../../../features/reports/search';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/reports/reimbursements')({
  validateSearch: z.object({
    ...paging,
    ...dateRange(),
    status: z.enum(REPORTED_CLAIM_STATUSES).optional().catch(undefined),
  }),
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['report.payroll', 'report.hr']),
  component: ReimbursementsReportPage,
});
