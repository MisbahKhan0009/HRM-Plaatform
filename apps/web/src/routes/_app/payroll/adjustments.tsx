import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AdjustmentsPage } from '../../../features/payroll/adjustments';
import { adjustmentSearch } from '../../../features/payroll/search';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/payroll/adjustments')({
  validateSearch: adjustmentSearch,
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['payroll.read.all']),
  component: Page,
});

function Page() {
  const params = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return <AdjustmentsPage params={params} onSearch={(search) => void navigate({ search })} />;
}
