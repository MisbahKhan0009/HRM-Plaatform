import { LoadingBlock } from '@hrm/ui';
import { createFileRoute } from '@tanstack/react-router';
import { employeeQueries, ensureOr404, ProfileChangeReviewPage } from '../../../../features/employees';
import { requireAny } from '../../../../lib/auth/me';

export const Route = createFileRoute('/_app/employees/profile-changes/$id')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['profile_change.review.all']),
  loader: ({ context, params }) =>
    ensureOr404(() => context.queryClient.ensureQueryData(employeeQueries.profileChange(params.id))),
  pendingComponent: () => <LoadingBlock label="profile change" />,
  component: ProfileChangeReviewPage,
});
