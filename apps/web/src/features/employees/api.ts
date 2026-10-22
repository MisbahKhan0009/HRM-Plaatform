import type {
  CreateEmployeeInput,
  CreateEmploymentContractInput,
  CreateEmploymentEventInput,
  CreateProfileChangeRequestInput,
  EffectiveActionInput,
  EmployeeBasic,
  EmployeeContact,
  EmployeeDetail,
  EmployeeFull,
  EmployeeImportPreview,
  EmployeeImportResult,
  EmployeeSelf,
  EmployeeStatus,
  EmploymentContract,
  EmploymentEvent,
  HeadcountRow,
  HireEmployeeInput,
  ImportField,
  InviteUserInput,
  ProfileChangeRequest,
  SeparateEmployeeInput,
  SettingsGroups,
  UpdateEmployeeContactInput,
  UpdateEmployeeInput,
  UpdateEmploymentContractInput,
  UserDetail,
  VersionOnlyInput,
} from '@hrm/contracts';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { notFound } from '@tanstack/react-router';
import { ApiError, api } from '../../lib/api/client';

/**
 * Loader helper: an out-of-scope or unknown record (404, or 400 for a malformed id) renders the not-found page,
 * the same as the API's answer (INFORMATION-ARCHITECTURE §2).
 */
export async function ensureOr404<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) throw notFound();
    throw err;
  }
}

type PageMeta = { number: number; size: number; totalItems: number; totalPages: number };
type Page<T> = { data: T[]; page: PageMeta };

export interface EmployeeListParams {
  page: number;
  pageSize: number;
  q?: string | undefined;
  status?: string | undefined;
  departmentId?: string | undefined;
  positionId?: string | undefined;
  managerId?: string | undefined;
  sort?: string | undefined;
}

/** Statuses the directory shows by default: every status except `archived` (SCREEN-INVENTORY §8.1). */
export const DEFAULT_DIRECTORY_STATUSES: EmployeeStatus[] = [
  'draft',
  'preboarding',
  'probation',
  'active',
  'notice_period',
  'separated',
];

export const employeeQueries = {
  all: () => ['employees'] as const,
  list: (p: EmployeeListParams) =>
    queryOptions({
      queryKey: [...employeeQueries.all(), 'list', p],
      queryFn: () => api.get<Page<EmployeeBasic>>('/employees', { query: { ...p } }),
    }),
  /** Picker search: at least two characters (the API's `q` minimum). */
  search: (q: string) =>
    queryOptions({
      queryKey: [...employeeQueries.all(), 'search', q],
      queryFn: () =>
        api
          .get<Page<EmployeeBasic>>('/employees', { query: { q, pageSize: 10, sort: 'lastName' } })
          .then((r) => r.data),
      enabled: q.trim().length >= 2,
      staleTime: 60_000,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...employeeQueries.all(), 'detail', id],
      queryFn: () => api.get<EmployeeDetail>(`/employees/${id}`),
    }),
  contact: (id: string) =>
    queryOptions({
      queryKey: [...employeeQueries.all(), 'contact', id],
      queryFn: () => api.get<EmployeeContact>(`/employees/${id}/contact`),
    }),
  history: (id: string, page = 1) =>
    queryOptions({
      queryKey: [...employeeQueries.all(), 'history', id, page],
      queryFn: () =>
        api.get<Page<EmploymentEvent>>(`/employees/${id}/history`, { query: { page, pageSize: 25 } }),
    }),
  contracts: (id: string) =>
    queryOptions({
      queryKey: [...employeeQueries.all(), 'contracts', id],
      queryFn: () =>
        api.get<Page<EmploymentContract>>(`/employees/${id}/contracts`, { query: { pageSize: 100 } }),
    }),
  myProfile: () =>
    queryOptions({
      queryKey: [...employeeQueries.all(), 'me'],
      queryFn: () => api.get<EmployeeSelf>('/me/profile'),
    }),
  profileChanges: (p: { page: number; pageSize: number; employeeId?: string; status?: string }) =>
    queryOptions({
      queryKey: [...employeeQueries.all(), 'profile-changes', p],
      queryFn: () => api.get<Page<ProfileChangeRequest>>('/profile-change-requests', { query: { ...p } }),
    }),
  /**
   * One profile change request. The API has no `GET /profile-change-requests/{id}`, so this pages through the list
   * (pending first, where review requests are) and answers 404 when the id is not in the caller's scope.
   */
  profileChange: (id: string) =>
    queryOptions({
      queryKey: [...employeeQueries.all(), 'profile-change', id],
      queryFn: async () => {
        for (const status of ['pending', undefined]) {
          for (let page = 1; page <= 20; page++) {
            const res = await api.get<Page<ProfileChangeRequest>>('/profile-change-requests', {
              query: { page, pageSize: 100, status },
            });
            const found = res.data.find((r) => r.id === id);
            if (found) return found;
            if (page >= res.page.totalPages) break;
          }
        }
        throw new ApiError(404, 'NOT_FOUND', 'Not found', [], null, null);
      },
    }),
  /** `employees.required_fields` when the caller may read settings; null means "use the catalogue default". */
  requiredFields: () =>
    queryOptions({
      queryKey: ['settings', 'employees.required_fields'],
      queryFn: async () => {
        const groups = await api.get<SettingsGroups>('/settings');
        const value = groups.hr?.find((s) => s.key === 'employees.required_fields')?.value;
        return Array.isArray(value) ? (value as string[]) : null;
      },
      staleTime: 5 * 60_000,
    }),
  headcountByStatus: () =>
    queryOptions({
      queryKey: ['reports', 'headcount', 'status'],
      queryFn: () =>
        api.get<{ data: HeadcountRow[]; summary: { asOf: string; total: number } }>('/reports/headcount', {
          query: { groupBy: 'status', pageSize: 100 },
        }),
    }),
};

export const directorySortValues = [
  'lastName',
  '-lastName',
  'employeeCode',
  '-employeeCode',
  'joiningDate',
  '-joiningDate',
] as const;
export type DirectorySort = (typeof directorySortValues)[number];

/** Directory search params as the route keeps them (SCREEN-INVENTORY §8.1). `status` 'all' includes archived. */
export interface DirectorySearch {
  page: number;
  pageSize: number;
  q?: string | undefined;
  status?: EmployeeStatus | 'all' | undefined;
  departmentId?: string | undefined;
  positionId?: string | undefined;
  managerId?: string | undefined;
  sort: DirectorySort;
}

export const directoryQuery = (s: DirectorySearch) =>
  employeeQueries.list({
    page: s.page,
    pageSize: s.pageSize,
    q: s.q && s.q.trim().length >= 2 ? s.q.trim() : undefined,
    status: s.status === 'all' ? undefined : (s.status ?? DEFAULT_DIRECTORY_STATUSES.join(',')),
    departmentId: s.departmentId,
    positionId: s.positionId,
    managerId: s.managerId,
    sort: s.sort,
  });

function useEmployeeMutation<V, R>(fn: (v: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: employeeQueries.all() }),
        queryClient.invalidateQueries({ queryKey: ['reports', 'headcount'] }),
      ]);
    },
  });
}

export const useCreateEmployee = () =>
  useEmployeeMutation((v: CreateEmployeeInput) => api.post<EmployeeFull>('/employees', v));

export const useUpdateEmployee = (id: string) =>
  useEmployeeMutation((v: UpdateEmployeeInput) => api.patch<EmployeeFull>(`/employees/${id}`, v));

export const useUpdateContact = (id: string) =>
  useEmployeeMutation((v: UpdateEmployeeContactInput) =>
    api.patch<EmployeeContact>(`/employees/${id}/contact`, v),
  );

export const useCreateEmploymentEvent = (id: string) =>
  useEmployeeMutation((v: CreateEmploymentEventInput) =>
    api.post<EmploymentEvent>(`/employees/${id}/employment-events`, v),
  );

export type LifecycleCommand =
  | { action: 'start-preboarding'; input: VersionOnlyInput }
  | { action: 'hire'; input: HireEmployeeInput }
  | { action: 'confirm'; input: EffectiveActionInput }
  | { action: 'start-notice'; input: EffectiveActionInput }
  | { action: 'separate'; input: SeparateEmployeeInput }
  | { action: 'rehire'; input: EffectiveActionInput }
  | { action: 'archive'; input: VersionOnlyInput };

export const useLifecycleAction = () =>
  useEmployeeMutation((c: LifecycleCommand & { id: string }) =>
    api.post<EmployeeFull>(`/employees/${c.id}/${c.action}`, c.input),
  );

export const useSaveContract = (employeeId: string) =>
  useEmployeeMutation(
    (v: { id?: string; create?: CreateEmploymentContractInput; update?: UpdateEmploymentContractInput }) =>
      v.id
        ? api.patch<EmploymentContract>(`/employees/${employeeId}/contracts/${v.id}`, v.update)
        : api.post<EmploymentContract>(`/employees/${employeeId}/contracts`, v.create),
  );

export const useInviteEmployee = () =>
  useEmployeeMutation((v: InviteUserInput) => api.post<UserDetail>('/users/invitations', v));

export const useImportPreview = () =>
  useMutation({
    mutationFn: (v: { csv: string; mapping?: Record<string, ImportField | null> }) =>
      api.post<EmployeeImportPreview>('/employees/import/preview', v),
  });

/** Commit sends an Idempotency-Key (API-CATALOGUE §4); a retry after step-up reuses it. */
export const useImportCommit = () =>
  useEmployeeMutation(
    (v: { csv: string; previewToken: string; mapping?: Record<string, ImportField | null> }) =>
      api.post<EmployeeImportResult>('/employees/import/commit', v, { idempotent: true }),
  );

function useProfileChangeMutation<V, R>(fn: (v: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: employeeQueries.all() }),
        queryClient.invalidateQueries({ queryKey: ['approvals'] }),
      ]);
    },
  });
}

export const useRequestProfileChange = () =>
  useProfileChangeMutation((v: CreateProfileChangeRequestInput) =>
    api.post<ProfileChangeRequest>('/profile-change-requests', v),
  );

export const useWithdrawProfileChange = () =>
  useProfileChangeMutation((v: { id: string; version: number }) =>
    api.post<ProfileChangeRequest>(`/profile-change-requests/${v.id}/withdraw`, { version: v.version }),
  );

export const useDecideProfileChange = () =>
  useProfileChangeMutation(
    (v: { id: string; decision: 'approve' | 'reject'; version: number; comment?: string }) =>
      api.post<ProfileChangeRequest>(`/profile-change-requests/${v.id}/${v.decision}`, {
        version: v.version,
        ...(v.comment ? { comment: v.comment } : {}),
      }),
  );

/** Tabs of the employee record (route search `tab`). */
export const recordTabValues = [
  'overview',
  'employment',
  'contact',
  'contracts',
  'documents',
  'attendance',
  'leave',
  'compensation',
] as const;
export type RecordTab = (typeof recordTabValues)[number];
