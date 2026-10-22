import { Alert, LoadingBlock, TableContainer } from '@hrm/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '../../../components/page-header';
import { roleQueries } from '../../../features/users/api';
import { RoleMatrix } from '../../../features/users/role-matrix';
import { requireAny, useCan } from '../../../lib/auth/me';

// `GET /roles` also allows `settings.read`; those users see the matrix read-only (SCREEN-INVENTORY §11).
export const Route = createFileRoute('/_app/settings/roles')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['role.manage', 'settings.read']),
  loader: ({ context }) => context.queryClient.ensureQueryData(roleQueries.list()),
  pendingComponent: () => <LoadingBlock label="roles" />,
  component: RolesPage,
});

function RolesPage() {
  const canEdit = useCan('role.manage');
  const { data: roles } = useSuspenseQuery(roleQueries.list());
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Roles"
        description="What each role can see and do. Manager and Employee come from the employee record and can't be assigned."
      />
      {canEdit ? null : <Alert>You can view roles but not change them.</Alert>}
      <TableContainer>
        <RoleMatrix roles={roles} canEdit={canEdit} />
      </TableContainer>
    </div>
  );
}
