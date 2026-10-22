import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { PayrollReportPage } from '../../../features/reports/PayrollReportPage';
import { paging, thisYear } from '../../../features/reports/search';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/reports/payroll')({
  validateSearch: z.object({
    ...paging,
    tab: z.enum(['register', 'deductions', 'reconciliation']).default('register').catch('register'),
    runId: z.uuid().optional().catch(undefined),
    year: z.number().int().min(2000).max(2100).default(thisYear).catch(thisYear),
  }),
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['report.payroll']),
  component: PayrollReportPage,
});
