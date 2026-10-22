import { createFileRoute } from '@tanstack/react-router';
import { leaveQueries } from '../../../features/leave/api';
import { LeaveTypesPage } from '../../../features/leave/pages/leave-types-page';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/settings/leave-types')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['settings.read', 'leave.policy.manage']),
  loader: ({ context }) => void context.queryClient.prefetchQuery(leaveQueries.types(true)),
  component: LeaveTypesPage,
});
