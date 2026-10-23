import { LoadingBlock } from '@hrm/ui';
import { createFileRoute } from '@tanstack/react-router';
import { claimQueries } from '../../../features/reimbursements/api';
import { ClaimDetailPage } from '../../../features/reimbursements/ClaimDetailPage';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/reimbursements/$claimId')({
  beforeLoad: ({ context }) =>
    requireAny(context.queryClient, [
      'reimbursement.request.own',
      'reimbursement.review.team',
      'reimbursement.read.all',
    ]),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(claimQueries.detail(params.claimId)),
  pendingComponent: () => <LoadingBlock label="Loading claim" />,
  component: ClaimDetailPage,
});
