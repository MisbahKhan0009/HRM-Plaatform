import { createFileRoute } from '@tanstack/react-router';
import { NewClaimPage } from '../../../features/reimbursements/NewClaimPage';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/reimbursements/new')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['reimbursement.request.own']),
  component: NewClaimPage,
});
