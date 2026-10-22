import { createFileRoute } from '@tanstack/react-router';
import { MyProfilePage } from '../../../features/employees/pages/my-profile-page';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/me/')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['employee.read.own']),
  component: MyProfilePage,
});
