import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { SalaryStructuresPage } from '../../../features/payroll/salary-structures';
import { structureSearch } from '../../../features/payroll/search';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/payroll/salary-structures')({
  validateSearch: structureSearch,
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['compensation.read.all']),
  component: Page,
});

function Page() {
  const params = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return <SalaryStructuresPage params={params} onSearch={(search) => void navigate({ search })} />;
}
