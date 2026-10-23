import { userStatusValues } from '@hrm/contracts';
import {
  Button,
  EmptyState,
  LoadingBlock,
  Pagination,
  SearchInput,
  Select,
  StatusBadge,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Plus, Users } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { PageHeader } from '../../../components/page-header';
import { ROLE_LABEL, userQueries } from '../../../features/users/api';
import { InviteUserDialog, UserRowActions } from '../../../features/users/components';
import { requireAny, useCan, useMe } from '../../../lib/auth/me';
import { formatRelative } from '../../../lib/format';

const search = z.object({
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(25).catch(25),
  status: z.enum(userStatusValues).optional().catch(undefined),
  q: z.string().trim().min(1).max(100).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/settings/users')({
  validateSearch: search,
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['user.manage']),
  loaderDeps: ({ search: s }) => s,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(userQueries.list(deps)),
  pendingComponent: () => <LoadingBlock label="users" />,
  component: UsersPage,
});

// SCREEN-INVENTORY §11 `/settings/users`, USER-FLOWS §2.
function UsersPage() {
  const { t } = useTranslation();
  const params = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const canAssignRoles = useCan('role.manage');
  const [inviting, setInviting] = useState(false);
  const [q, setQ] = useState(params.q ?? '');

  // Search as the user types, without a navigation per keystroke.
  useEffect(() => {
    const next = q.trim() || undefined;
    if (next === params.q) return;
    const id = setTimeout(() => void navigate({ search: { ...params, page: 1, q: next } }), 300);
    return () => clearTimeout(id);
  }, [q, params, navigate]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users"
        description="Sign-in accounts. Being a system admin doesn't give access to salary or employee records."
        actions={
          <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => setInviting(true)}>
            Invite user
          </Button>
        }
      />
      <TableContainer
        toolbar={
          <>
            <SearchInput
              aria-label="Search by name or email"
              placeholder="Search by name or email"
              className="w-full sm:w-72"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onClear={() => setQ('')}
            />
            <Select
              aria-label="Status"
              className="w-full sm:w-44"
              value={params.status ?? ''}
              onChange={(e) =>
                void navigate({
                  search: { ...params, page: 1, status: (e.target.value || undefined) as never },
                })
              }
            >
              <option value="">All statuses</option>
              {userStatusValues.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
          </>
        }
      >
        <Suspense fallback={<LoadingBlock label="users" />}>
          <UsersTable canAssignRoles={canAssignRoles} />
        </Suspense>
      </TableContainer>
      <p className="text-sm text-text-2">Manager and Employee roles come from the employee record.</p>
      {inviting ? (
        <InviteUserDialog canAssignRoles={canAssignRoles} onClose={() => setInviting(false)} />
      ) : null}
    </div>
  );
}

function UsersTable({ canAssignRoles }: { canAssignRoles: boolean }) {
  const { t } = useTranslation();
  const params = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const me = useMe();
  const { data } = useSuspenseQuery(userQueries.list(params));
  if (!data.data.length) {
    return params.status || params.q ? (
      <EmptyState
        icon={Users}
        variant="no-results"
        title="No results"
        description="Try fewer filters or a different search."
        className="border-0"
      />
    ) : (
      <EmptyState
        icon={Users}
        title="No users yet"
        description="Invite people so they can sign in."
        className="border-0"
      />
    );
  }
  return (
    <>
      <Table>
        <THead>
          <tr>
            <TH>User</TH>
            <TH>Roles</TH>
            <TH>Status</TH>
            <TH>Last sign-in</TH>
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {data.data.map((u) => {
            const isSelf = u.id === me?.user.id;
            return (
              <TR key={u.id}>
                <TD className="py-2">
                  <div className="font-medium">
                    {u.name}
                    {isSelf ? <span className="ml-2 text-sm font-normal text-text-2">(you)</span> : null}
                  </div>
                  <div className="text-sm text-text-2">{u.email}</div>
                </TD>
                <TD>
                  {u.roles.length ? (
                    u.roles.map((r) => ROLE_LABEL[r]).join(', ')
                  ) : (
                    <span className="text-text-2">None</span>
                  )}
                </TD>
                <TD>
                  <StatusBadge status={u.status} label={t(`status.${u.status}`)} />
                </TD>
                <TD className="whitespace-nowrap">
                  {u.lastLoginAt ? (
                    <span title={u.lastLoginAt}>{formatRelative(u.lastLoginAt)}</span>
                  ) : (
                    <span className="text-text-2">Never</span>
                  )}
                </TD>
                <TD className="text-right">
                  <UserRowActions user={u} isSelf={isSelf} canAssignRoles={canAssignRoles} />
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <div className="border-t border-line px-4 py-2">
        <Pagination
          page={data.page.number}
          pageSize={data.page.size}
          totalItems={data.page.totalItems}
          onPage={(page) => void navigate({ search: { ...params, page } })}
          onPageSize={(pageSize) => void navigate({ search: { ...params, page: 1, pageSize } })}
        />
      </div>
    </>
  );
}
