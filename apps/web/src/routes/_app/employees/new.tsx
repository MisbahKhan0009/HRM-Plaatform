import { createFileRoute } from '@tanstack/react-router';
import { NewEmployeePage } from '../../../features/employees/pages/new-employee-page';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/employees/new')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['employee.manage']),
  component: NewEmployeePage,
});
