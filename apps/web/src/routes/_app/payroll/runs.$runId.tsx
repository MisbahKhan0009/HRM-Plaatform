import { LoadingBlock } from '@hrm/ui';
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router';
import { payrollQueries } from '../../../features/payroll/api';
import { PayrollRunPage } from '../../../features/payroll/run-page';
import { runSearch } from '../../../features/payroll/search';
import { ApiError } from '../../../lib/api/client';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/payroll/runs/$runId')({
  validateSearch: runSearch,
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['payroll.read.all']),
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(payrollQueries.run(params.runId));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) throw notFound();
      throw err;
    }
  },
  pendingComponent: () => <LoadingBlock label="payroll run" rows={6} />,
  component: Page,
});

function Page() {
  const { runId } = Route.useParams();
  const s = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <PayrollRunPage
      runId={runId}
      search={s}
      onSearch={(patch) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })}
    />
  );
}
