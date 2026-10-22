import { createFileRoute } from '@tanstack/react-router';
import { MyCompensationPage } from '../../../features/payroll/my-compensation';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/me/compensation')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['compensation.read.own']),
  component: MyCompensationPage,
});
