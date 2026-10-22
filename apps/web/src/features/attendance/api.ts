import type {
  AttendanceCorrection,
  AttendanceCorrectionStatus,
  AttendanceDayDetail,
  AttendanceRecord,
  AttendanceStatus,
  AttendanceSummaryRow,
  CreateAttendanceCorrectionInput,
  CreateManualEntryInput,
  MyAttendanceResponse,
  PunchResult,
} from '@hrm/contracts';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { notFound } from '@tanstack/react-router';
import { ApiError, api } from '../../lib/api/client';
import { todayIso } from '../../lib/format';

export type Page<T> = {
  data: T[];
  page: { number: number; size: number; totalItems: number; totalPages: number };
};

export interface MyAttendanceParams {
  from: string;
  to: string;
}

export interface RecordListParams {
  from: string;
  to: string;
  page: number;
  pageSize: number;
  employeeId?: string | undefined;
  departmentId?: string | undefined;
  status?: AttendanceStatus | undefined;
  needsReview?: boolean | undefined;
}

export interface CorrectionListParams {
  page: number;
  pageSize: number;
  employeeId?: string | undefined;
  status?: AttendanceCorrectionStatus | undefined;
}

export const attendanceQueries = {
  all: () => ['attendance'] as const,
  /** Own records for a range plus today's state (`GET /attendance/me`). */
  me: (p: MyAttendanceParams) =>
    queryOptions({
      queryKey: [...attendanceQueries.all(), 'me', p],
      queryFn: () =>
        api.get<MyAttendanceResponse>('/attendance/me', {
          query: { ...p, pageSize: 100, sort: 'workDate' },
        }),
    }),
  /** Today's state only: the dashboard widget and the top-bar shortcut. */
  today: () => {
    const today = todayIso();
    return queryOptions({
      queryKey: [...attendanceQueries.all(), 'me', 'today', today],
      queryFn: () =>
        api
          .get<MyAttendanceResponse>('/attendance/me', { query: { from: today, to: today, pageSize: 1 } })
          .then((r) => r.today),
    });
  },
  list: (p: RecordListParams) =>
    queryOptions({
      queryKey: [...attendanceQueries.all(), 'records', p],
      queryFn: () =>
        api.get<Page<AttendanceRecord>>('/attendance', {
          query: { ...p, needsReview: p.needsReview === undefined ? undefined : String(p.needsReview) },
        }),
    }),
  summary: (p: { from: string; to: string; pageSize?: number }) =>
    queryOptions({
      queryKey: [...attendanceQueries.all(), 'summary', p],
      queryFn: () =>
        api.get<Page<AttendanceSummaryRow>>('/attendance/summary', {
          query: { from: p.from, to: p.to, pageSize: p.pageSize ?? 100 },
        }),
    }),
  day: (employeeId: string, workDate: string) =>
    queryOptions({
      queryKey: [...attendanceQueries.all(), 'day', employeeId, workDate],
      queryFn: () => api.get<AttendanceDayDetail>(`/attendance/${employeeId}/${workDate}`),
    }),
  corrections: (p: CorrectionListParams) =>
    queryOptions({
      queryKey: [...attendanceQueries.all(), 'corrections', p],
      queryFn: () => api.get<Page<AttendanceCorrection>>('/attendance/corrections', { query: { ...p } }),
    }),
  correction: (id: string) =>
    queryOptions({
      queryKey: [...attendanceQueries.all(), 'correction', id],
      queryFn: () => api.get<AttendanceCorrection>(`/attendance/corrections/${id}`),
    }),
};

/** Punches change today's panel, the records and the dashboard widgets (ARCHITECTURE §5). */
function usePunch(kind: 'check-in' | 'check-out') {
  const queryClient = useQueryClient();
  return useMutation({
    // USER-FLOWS §3 step 2 sends an Idempotency-Key; the button is disabled while pending, so a double tap is one call.
    mutationFn: () => api.post<PunchResult>(`/attendance/${kind}`, {}, { idempotent: true }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: attendanceQueries.all() }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]),
  });
}

export const useCheckIn = () => usePunch('check-in');
export const useCheckOut = () => usePunch('check-out');

/** Correction changes touch attendance and the approval inbox (ARCHITECTURE §5). */
function useCorrectionMutation<V, R>(fn: (v: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: attendanceQueries.all() }),
        queryClient.invalidateQueries({ queryKey: ['approvals'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]),
  });
}

export const useRequestCorrection = () =>
  useCorrectionMutation((v: CreateAttendanceCorrectionInput) =>
    api.post<AttendanceCorrection>('/attendance/corrections', v),
  );
export const useWithdrawCorrection = () =>
  useCorrectionMutation((c: { id: string; version: number }) =>
    api.post<AttendanceCorrection>(`/attendance/corrections/${c.id}/withdraw`, { version: c.version }),
  );
export const useDecideCorrection = () =>
  useCorrectionMutation(
    (v: { id: string; version: number; decision: 'approve' | 'reject'; comment?: string | undefined }) =>
      api.post<AttendanceCorrection>(`/attendance/corrections/${v.id}/${v.decision}`, {
        version: v.version,
        ...(v.comment ? { comment: v.comment } : {}),
      }),
  );

/** Loader helper: a 404 (out of scope) or 400 (malformed id) from the API shows the not-found page (IA §1). */
export async function ensureFound<T>(load: Promise<T>): Promise<T> {
  try {
    return await load;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) throw notFound();
    throw err;
  }
}

export function useCreateManualEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: CreateManualEntryInput) => api.post<AttendanceDayDetail>('/attendance/manual-entries', v),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: attendanceQueries.all() }),
  });
}
