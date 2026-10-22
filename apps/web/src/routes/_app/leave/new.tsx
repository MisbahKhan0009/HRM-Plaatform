import { createFileRoute } from '@tanstack/react-router';
import { leaveQueries } from '../../../features/leave/api';
import { NewLeaveRequestPage } from '../../../features/leave/pages/new-request-page';
import { requireAny } from '../../../lib/auth/me';

// INFORMATION-ARCHITECTURE §2: own requests; HR files on an employee's behalf with `leave.request.review.all` (D-014).
export const Route = createFileRoute('/_app/leave/new')({
  beforeLoad: ({ context }) =>
    requireAny(context.queryClient, ['leave.request.own', 'leave.request.review.all']),
  loader: ({ context }) => void context.queryClient.prefetchQuery(leaveQueries.types()),
  component: NewLeaveRequestPage,
});
