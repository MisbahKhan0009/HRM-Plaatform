import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { PayslipsPage } from '../../../features/payroll/payslips';
import { payslipSearch } from '../../../features/payroll/search';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/payslips/')({
  validateSearch: payslipSearch,
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['payslip.read.own', 'payslip.read.all']),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return <PayslipsPage search={search} onSearch={(s) => void navigate({ search: s })} />;
}
