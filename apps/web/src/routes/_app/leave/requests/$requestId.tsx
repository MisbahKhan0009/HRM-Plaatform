import { LoadingBlock } from '@hrm/ui';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { leaveQueries } from '../../../../features/leave/api';
import { LeaveRequestDetailPage } from '../../../../features/leave/pages/request-detail-page';
import { ApiError } from '../../../../lib/api/client';
import { requireAny } from '../../../../lib/auth/me';

export const Route = createFileRoute('/_app/leave/requests/$requestId')({
  beforeLoad: ({ context }) =>
    requireAny(context.queryClient, ['leave.request.own', 'leave.read.team', 'leave.read.all']),
  // Out-of-scope requests answer 404 from the API; the page shows the same not-found page (SECURITY-MODEL).
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(leaveQueries.request(params.requestId));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) throw notFound();
      throw err;
    }
  },
  pendingComponent: () => <LoadingBlock label="Loading leave request" />,
  component: LeaveRequestDetailPage,
});
