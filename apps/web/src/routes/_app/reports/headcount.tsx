import { headcountGroupValues, IsoDateSchema } from '@hrm/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { HeadcountReportPage } from '../../../features/reports/HeadcountReportPage';
import { paging } from '../../../features/reports/search';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/reports/headcount')({
  validateSearch: z.object({
    ...paging,
    asOf: IsoDateSchema.optional().catch(undefined),
    departmentId: z.uuid().optional().catch(undefined),
    groupBy: z.enum(headcountGroupValues).default('department').catch('department'),
  }),
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['report.hr']),
  component: HeadcountReportPage,
});
