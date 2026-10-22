import type {
  AssignableRoleCode,
  InviteUserInput,
  PermissionInfo,
  Role,
  RoleCode,
  UpdateRoleInput,
  UserAction,
  UserActionInput,
  UserDetail,
  UserStatus,
  UserSummary,
} from '@hrm/contracts';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';

export interface UserListParams {
  page: number;
  pageSize: number;
  status?: UserStatus | undefined;
  q?: string | undefined;
}

type Page<T> = { data: T[]; page: { number: number; size: number; totalItems: number; totalPages: number } };

export const userQueries = {
  all: () => ['users'] as const,
  list: (p: UserListParams) =>
    queryOptions({
      queryKey: [...userQueries.all(), 'list', p],
      queryFn: () => api.get<Page<UserSummary>>('/users', { query: { ...p } }),
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...userQueries.all(), 'detail', id],
      queryFn: () => api.get<UserDetail>(`/users/${id}`),
    }),
};

export const roleQueries = {
  all: () => ['roles'] as const,
  list: () =>
    queryOptions({
      queryKey: [...roleQueries.all(), 'list'],
      queryFn: () => api.get<{ data: Role[] }>('/roles').then((r) => r.data),
    }),
  permissions: () =>
    queryOptions({
      queryKey: [...roleQueries.all(), 'permissions'],
      queryFn: () => api.get<{ data: PermissionInfo[] }>('/permissions').then((r) => r.data),
      staleTime: Number.POSITIVE_INFINITY,
    }),
};

function useUsersMutation<V, R>(fn: (v: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: userQueries.all() });
      // Role user counts change with role assignments.
      await queryClient.invalidateQueries({ queryKey: roleQueries.all() });
    },
  });
}

export const useInviteUser = () =>
  useUsersMutation((v: InviteUserInput) => api.post<UserDetail>('/users/invitations', v));
export const useResendInvitation = () =>
  useUsersMutation((id: string) => api.post<UserDetail>(`/users/${id}/invitations/resend`));
export const useUserAction = () =>
  useUsersMutation((v: { id: string; action: UserAction | 'reset-auth'; input: UserActionInput }) =>
    api.post<UserDetail>(`/users/${v.id}/${v.action}`, v.input),
  );
export const useReplaceRoles = () =>
  useUsersMutation((v: { id: string; roleCodes: AssignableRoleCode[]; version: number }) =>
    api.post<UserDetail>(`/users/${v.id}/roles`, { roleCodes: v.roleCodes, version: v.version }),
  );

export function useUpdateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; input: UpdateRoleInput }) => api.patch<Role>(`/roles/${v.id}`, v.input),
    // Also after a version conflict, so the matrix shows the latest grants.
    onSettled: () => queryClient.invalidateQueries({ queryKey: roleQueries.all() }),
  });
}

/** Display names for role codes; the API's own names are used where the role list is loaded. */
export const ROLE_LABEL: Record<RoleCode, string> = {
  system_admin: 'System admin',
  hr_admin: 'HR admin',
  payroll_officer: 'Payroll officer',
  director: 'Director',
  auditor: 'Auditor',
  manager: 'Manager',
  employee: 'Employee',
};
