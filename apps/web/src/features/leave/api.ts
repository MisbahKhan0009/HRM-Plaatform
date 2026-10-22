import type {
  AdjustLeaveBalanceInput,
  allocationMethodValues,
  CreateLeavePolicyInput,
  CreateLeaveRequestInput,
  CreateLeaveTypeInput,
  LeaveBalance,
  LeaveCalendar,
  LeaveLedgerEntry,
  LeavePolicy,
  LeaveRequestDto,
  LeaveRequestPreview,
  LeaveRequestStatus,
  LeaveType,
  MyLeaveBalances,
  UpdateLeaveTypeInput,
} from '@hrm/contracts';
import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';

type List<T> = { data: T[] };
export type Page<T> = {
  data: T[];
  page: { number: number; size: number; totalItems: number; totalPages: number };
};

export interface LeaveRequestListParams {
  page: number;
  pageSize: number;
  status?: LeaveRequestStatus | undefined;
  employeeId?: string | undefined;
  leaveTypeId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface BalanceListParams {
  page: number;
  pageSize: number;
  year: number;
  employeeId?: string | undefined;
  leaveTypeId?: string | undefined;
}

// Query keys start with the module (ARCHITECTURE §5); list params are the validated search params.
export const leaveQueries = {
  all: () => ['leave'] as const,
  types: (includeInactive = false) =>
    queryOptions({
      queryKey: ['leave', 'types', { includeInactive }],
      queryFn: () =>
        api.get<List<LeaveType>>('/leave/types', { query: { includeInactive } }).then((r) => r.data),
    }),
  policies: (typeId: string) =>
    queryOptions({
      queryKey: ['leave', 'types', typeId, 'policies'],
      queryFn: () => api.get<List<LeavePolicy>>(`/leave/types/${typeId}/policies`).then((r) => r.data),
    }),
  myBalances: (year?: number) =>
    queryOptions({
      queryKey: ['leave', 'balances', 'me', { year }],
      queryFn: () => api.get<MyLeaveBalances>('/leave/balances/me', { query: { year } }),
    }),
  balances: (p: BalanceListParams) =>
    queryOptions({
      queryKey: ['leave', 'balances', 'list', p],
      queryFn: () => api.get<Page<LeaveBalance>>('/leave/balances', { query: { ...p } }),
      placeholderData: keepPreviousData,
    }),
  ledger: (employeeId: string, p: { year: number; page: number; pageSize: number }) =>
    queryOptions({
      queryKey: ['leave', 'ledger', employeeId, p],
      queryFn: () =>
        api.get<Page<LeaveLedgerEntry>>(`/leave/balances/${employeeId}/ledger`, { query: { ...p } }),
    }),
  requests: (p: LeaveRequestListParams) =>
    queryOptions({
      queryKey: ['leave', 'requests', p],
      queryFn: () => api.get<Page<LeaveRequestDto>>('/leave/requests', { query: { ...p } }),
      placeholderData: keepPreviousData,
    }),
  request: (id: string) =>
    queryOptions({
      queryKey: ['leave', 'request', id],
      queryFn: () => api.get<LeaveRequestDto>(`/leave/requests/${id}`),
    }),
  calendar: (from: string, to: string) =>
    queryOptions({
      queryKey: ['leave', 'calendar', { from, to }],
      queryFn: () => api.get<LeaveCalendar>('/leave/calendar', { query: { from, to } }),
    }),
  /** Advisory preview (FORMS-AND-VALIDATION §2): never retried, never blocks submit. */
  preview: (input: CreateLeaveRequestInput) =>
    queryOptions({
      queryKey: ['leave', 'preview', input],
      queryFn: ({ signal }) =>
        api.post<LeaveRequestPreview>('/leave/requests/preview', input, { signal, noStepUp: true }),
      retry: false,
      staleTime: 0,
      placeholderData: keepPreviousData,
    }),
};

/** Leave mutations invalidate `['leave']` and `['approvals']` (ARCHITECTURE §5). */
function useLeaveMutation<V, R>(fn: (v: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: leaveQueries.all() }),
        queryClient.invalidateQueries({ queryKey: ['approvals'] }),
      ]),
  });
}

export const useCreateLeaveRequest = () =>
  useLeaveMutation((v: CreateLeaveRequestInput) => api.post<LeaveRequestDto>('/leave/requests', v));

export type LeaveAction = 'withdraw' | 'approve' | 'reject' | 'cancel' | 'cancelApprove' | 'cancelReject';

const ACTION_PATH: Record<LeaveAction, string> = {
  withdraw: 'withdraw',
  approve: 'approve',
  reject: 'reject',
  cancel: 'cancel',
  cancelApprove: 'cancel/approve',
  cancelReject: 'cancel/reject',
};

/** Approvals carry an Idempotency-Key because they post ledger entries (API-CATALOGUE §6). */
const IDEMPOTENT: ReadonlySet<LeaveAction> = new Set(['approve', 'cancelApprove']);

export const useLeaveAction = () =>
  useLeaveMutation(
    (v: { id: string; action: LeaveAction; version: number; comment?: string | undefined }) => {
      const body: Record<string, unknown> = { version: v.version };
      if (v.comment) body[v.action === 'cancel' ? 'reason' : 'comment'] = v.comment;
      return api.post<LeaveRequestDto>(`/leave/requests/${v.id}/${ACTION_PATH[v.action]}`, body, {
        idempotent: IDEMPOTENT.has(v.action),
      });
    },
  );

export const useAdjustBalance = () =>
  useLeaveMutation((v: AdjustLeaveBalanceInput) =>
    api.post<LeaveBalance>('/leave/balances/adjustments', v, { idempotent: true }),
  );

export const useSaveLeaveType = () =>
  useLeaveMutation((v: { id?: string; create?: CreateLeaveTypeInput; update?: UpdateLeaveTypeInput }) =>
    v.id
      ? api.patch<LeaveType>(`/leave/types/${v.id}`, v.update)
      : api.post<LeaveType>('/leave/types', v.create),
  );

export const useCreatePolicy = () =>
  useLeaveMutation((v: { typeId: string; input: CreateLeavePolicyInput }) =>
    api.post<LeavePolicy>(`/leave/types/${v.typeId}/policies`, v.input),
  );

export const ALLOCATION_LABEL: Record<(typeof allocationMethodValues)[number], string> = {
  annual_grant: 'Annual grant',
  monthly_accrual: 'Monthly accrual',
  per_days_worked: 'Per days worked',
  manual: 'Manual (HR adjustment)',
};

export const LEDGER_TYPE_LABEL: Record<LeaveLedgerEntry['type'], string> = {
  grant: 'Grant',
  accrual: 'Accrual',
  reservation: 'Reservation',
  reservation_release: 'Reservation released',
  usage: 'Usage',
  adjustment: 'Adjustment',
  reversal: 'Reversal',
  carry_forward: 'Carry-forward',
  expiry: 'Expiry',
};
