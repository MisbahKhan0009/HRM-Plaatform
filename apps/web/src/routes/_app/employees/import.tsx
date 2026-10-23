import { createFileRoute } from '@tanstack/react-router';
import { ImportPage } from '../../../features/employees/pages/import-page';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/employees/import')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['employee.manage']),
  component: ImportPage,
});
