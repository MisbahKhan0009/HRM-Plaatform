import { createFileRoute } from '@tanstack/react-router';
import { ReportsIndexPage } from '../../../features/reports/ReportsIndexPage';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/reports/')({
  beforeLoad: ({ context }) =>
    requireAny(context.queryClient, ['report.hr', 'report.payroll', 'report.team']),
  component: ReportsIndexPage,
});
