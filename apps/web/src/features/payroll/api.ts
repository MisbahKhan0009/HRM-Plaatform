import type {
  AdjustmentStatus,
  AuditLogEntry,
  CancelPaymentInput,
  CreateAdjustmentInput,
  CreatePayrollPeriodInput,
  CreateSalaryStructureInput,
  PaymentImportResult,
  PayrollAdjustment,
  PayrollFlag,
  PayrollItem,
  PayrollItemDetail,
  PayrollPayment,
  PayrollPeriod,
  PayrollRun,
  PayrollRunStatus,
  PayrollValidation,
  PayslipData,
  PayslipSummary,
  PublishPayslipsResult,
  Reconciliation,
  RecordPaymentInput,
  SalaryStructure,
} from '@hrm/contracts';
import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';

// Payroll, compensation and payslips (API-CATALOGUE §8). Money stays `{ amount: string }` end to end (ADR-0006).

export type Page<T> = {
  data: T[];
  page: { number: number; size: number; totalItems: number; totalPages: number };
};

export interface RunListParams {
  page: number;
  pageSize: number;
  status?: PayrollRunStatus | undefined;
  periodId?: string | undefined;
}

export interface ItemListParams {
  page: number;
  pageSize: number;
  flag?: PayrollFlag | undefined;
  employeeId?: string | undefined;
}

export interface AdjustmentListParams {
  page: number;
  pageSize: number;
  status?: AdjustmentStatus | undefined;
  periodId?: string | undefined;
}

export interface StructureListParams {
  page: number;
  pageSize: number;
  employeeId?: string | undefined;
}

export interface PayslipListParams {
  page: number;
  pageSize: number;
  year?: number | undefined;
}

const P = ['payroll'] as const;

export const payrollQueries = {
  all: () => P,
  periods: (year?: number) =>
    queryOptions({
      queryKey: [...P, 'periods', { year }],
      queryFn: () => api.get<Page<PayrollPeriod>>('/payroll/periods', { query: { year, pageSize: 100 } }),
    }),
  runs: (p: RunListParams) =>
    queryOptions({
      queryKey: [...P, 'runs', 'list', p],
      queryFn: () => api.get<Page<PayrollRun>>('/payroll/runs', { query: { ...p } }),
      placeholderData: keepPreviousData,
    }),
  run: (id: string) =>
    queryOptions({
      queryKey: [...P, 'runs', id],
      queryFn: () => api.get<PayrollRun>(`/payroll/runs/${id}`),
    }),
  items: (runId: string, p: ItemListParams) =>
    queryOptions({
      queryKey: [...P, 'runs', runId, 'items', p],
      queryFn: () => api.get<Page<PayrollItem>>(`/payroll/runs/${runId}/items`, { query: { ...p } }),
      placeholderData: keepPreviousData,
    }),
  item: (runId: string, itemId: string) =>
    queryOptions({
      queryKey: [...P, 'runs', runId, 'item', itemId],
      queryFn: () => api.get<PayrollItemDetail>(`/payroll/runs/${runId}/items/${itemId}`),
    }),
  /** `POST …/validate` re-runs the checks without a state change (`payroll.prepare`). */
  validation: (runId: string, version: number) =>
    queryOptions({
      queryKey: [...P, 'runs', runId, 'validation', version],
      queryFn: () => api.post<PayrollValidation>(`/payroll/runs/${runId}/validate`),
    }),
  reconciliation: (runId: string) =>
    queryOptions({
      queryKey: [...P, 'runs', runId, 'reconciliation'],
      queryFn: () => api.get<Reconciliation>(`/payroll/runs/${runId}/reconciliation`),
    }),
  /** The run's audit trail (History tab); needs an audit permission. */
  history: (entityId: string, from: string, to: string) =>
    queryOptions({
      queryKey: [...P, 'history', entityId, from, to],
      queryFn: () =>
        api.get<Page<AuditLogEntry>>('/audit-logs', {
          query: { entityType: 'payroll_run', entityId, from, to, pageSize: 100 },
        }),
    }),
  /**
   * Payment ids for the Payments tab. The API has no payment list yet, so recorded and cancelled payments are read
   * from the payroll audit trail (`audit.read.payroll`).
   */
  paymentEvents: (from: string, to: string) =>
    queryOptions({
      queryKey: [...P, 'payment-events', from, to],
      queryFn: () =>
        api.get<Page<AuditLogEntry>>('/audit-logs', {
          query: { entityType: 'payroll_payment', category: 'payroll', from, to, pageSize: 100 },
        }),
    }),
  adjustments: (p: AdjustmentListParams) =>
    queryOptions({
      queryKey: [...P, 'adjustments', p],
      queryFn: () => api.get<Page<PayrollAdjustment>>('/payroll/adjustments', { query: { ...p } }),
      placeholderData: keepPreviousData,
    }),
  structures: (p: StructureListParams) =>
    queryOptions({
      queryKey: [...P, 'structures', p],
      queryFn: () => api.get<Page<SalaryStructure>>('/salary-structures', { query: { ...p } }),
      placeholderData: keepPreviousData,
    }),
  payslipsMine: (p: PayslipListParams) =>
    queryOptions({
      queryKey: [...P, 'payslips', 'mine', p],
      queryFn: () => api.get<Page<PayslipSummary>>('/payroll/payslips/me', { query: { ...p } }),
    }),
  payslipsAll: (p: PayslipListParams & { employeeId?: string | undefined }) =>
    queryOptions({
      queryKey: [...P, 'payslips', 'all', p],
      queryFn: () => api.get<Page<PayslipSummary>>('/payroll/payslips', { query: { ...p } }),
    }),
  payslip: (id: string) =>
    queryOptions({
      queryKey: [...P, 'payslips', 'detail', id],
      queryFn: () => api.get<PayslipData>(`/payroll/payslips/${id}`),
      staleTime: Number.POSITIVE_INFINITY,
    }),
};

function usePayrollMutation<V, R>(fn: (v: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: payrollQueries.all() }),
  });
}

export const useCreatePeriod = () =>
  usePayrollMutation((v: CreatePayrollPeriodInput) => api.post<PayrollPeriod>('/payroll/periods', v));

export const useCreateRun = () =>
  usePayrollMutation((v: { periodId: string; runType: 'regular' | 'off_cycle' }) =>
    api.post<PayrollRun>('/payroll/runs', v, { idempotent: true }),
  );

/** Run transitions (DOMAIN-MODEL §5.6). Each sends the `version` read; money transitions send a key. */
export type RunAction =
  | { action: 'calculate' | 'submit' | 'lock' | 'mark-paid' | 'reconcile'; version: number }
  | { action: 'approve'; version: number; comment?: string; selfApprovalNote?: string }
  | { action: 'return'; version: number; reason: string };

const KEYED = new Set(['calculate', 'submit', 'approve', 'lock']);

export const useRunAction = (runId: string) =>
  usePayrollMutation(({ action, ...body }: RunAction) =>
    api.post<PayrollRun>(`/payroll/runs/${runId}/${action}`, body, { idempotent: KEYED.has(action) }),
  );

export const usePublishPayslips = (runId: string) =>
  usePayrollMutation(() =>
    api.post<PublishPayslipsResult>(`/payroll/runs/${runId}/publish-payslips`, undefined, {
      idempotent: true,
    }),
  );

export const useRecordPayment = (runId: string) =>
  usePayrollMutation((v: RecordPaymentInput) =>
    api.post<PayrollPayment>(`/payroll/runs/${runId}/payments`, v, { idempotent: true }),
  );

export const useImportPayments = (runId: string) =>
  usePayrollMutation((v: { csv: string; dryRun: boolean }) =>
    api.post<PaymentImportResult>(
      `/payroll/runs/${runId}/payments/import`,
      { csv: v.csv },
      { idempotent: true, query: { dryRun: v.dryRun ? 'true' : 'false' } },
    ),
  );

export const useCancelPayment = () =>
  usePayrollMutation((v: { paymentId: string } & CancelPaymentInput) =>
    api.post<PayrollPayment>(`/payroll/payments/${v.paymentId}/cancel`, {
      reason: v.reason,
      outcome: v.outcome,
    }),
  );

export const useCreateAdjustment = () =>
  usePayrollMutation((v: CreateAdjustmentInput) =>
    api.post<PayrollAdjustment>('/payroll/adjustments', v, { idempotent: true }),
  );

export const useDecideAdjustment = () =>
  usePayrollMutation(
    (
      v:
        | { id: string; decision: 'approve'; version: number; selfApprovalNote?: string }
        | { id: string; decision: 'reject'; version: number; comment: string },
    ) => {
      const { id, decision, ...body } = v;
      return api.post<PayrollAdjustment>(`/payroll/adjustments/${id}/${decision}`, body);
    },
  );

export const useCreateStructure = () =>
  usePayrollMutation((v: CreateSalaryStructureInput) => api.post<SalaryStructure>('/salary-structures', v));

export const useApproveStructure = () =>
  usePayrollMutation((v: { id: string; version: number }) =>
    api.post<SalaryStructure>(`/salary-structures/${v.id}/approve`, { version: v.version }),
  );
