import { LoadingBlock } from '@hrm/ui';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { payrollQueries } from '../../../features/payroll/api';
import { PayrollRunsPage } from '../../../features/payroll/runs-list';
import { runListSearch } from '../../../features/payroll/search';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/payroll/')({
  validateSearch: runListSearch,
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['payroll.read.all']),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(payrollQueries.runs(deps)),
  pendingComponent: () => <LoadingBlock label="payroll runs" />,
  component: Page,
});

function Page() {
  const params = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return <PayrollRunsPage params={params} onSearch={(search) => void navigate({ search })} />;
}
