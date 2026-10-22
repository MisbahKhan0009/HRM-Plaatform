import { LoadingBlock } from '@hrm/ui';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { payrollQueries } from '../../../features/payroll/api';
import { PayslipPage } from '../../../features/payroll/payslips';
import { ApiError } from '../../../lib/api/client';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/payslips/$payslipId')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['payslip.read.own', 'payslip.read.all']),
  // Another employee's payslip is a 404, the same as a missing one (E2E-09).
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(payrollQueries.payslip(params.payslipId));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) throw notFound();
      throw err;
    }
  },
  pendingComponent: () => <LoadingBlock label="payslip" rows={6} />,
  component: Page,
});

function Page() {
  const { payslipId } = Route.useParams();
  return <PayslipPage payslipId={payslipId} />;
}
