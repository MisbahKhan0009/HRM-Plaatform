import { createFileRoute } from '@tanstack/react-router';
import { MyProfileChangesPage } from '../../../features/employees/pages/my-profile-changes-page';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/me/profile-changes')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['employee.read.own']),
  component: MyProfileChangesPage,
});
