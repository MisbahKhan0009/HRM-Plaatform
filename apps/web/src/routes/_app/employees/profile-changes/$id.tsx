import { LoadingBlock } from '@hrm/ui';
import { createFileRoute } from '@tanstack/react-router';
import { employeeQueries, ensureOr404 } from '../../../../features/employees/api';
import { ProfileChangeReviewPage } from '../../../../features/employees/pages/profile-change-review-page';
import { requireAny } from '../../../../lib/auth/me';

export const Route = createFileRoute('/_app/employees/profile-changes/$id')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['profile_change.review.all']),
  loader: ({ context, params }) =>
    ensureOr404(() => context.queryClient.ensureQueryData(employeeQueries.profileChange(params.id))),
  pendingComponent: () => <LoadingBlock label="profile change" />,
  component: ProfileChangeReviewPage,
});
