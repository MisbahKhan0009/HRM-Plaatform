import type {
  ClaimList,
  ClaimStatus,
  CreateClaimInput,
  DocumentDetail,
  ReimbursementClaim,
  UpdateClaimInput,
} from '@hrm/contracts';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import { upload } from '../../lib/api/upload';

export interface ClaimListParams {
  page: number;
  pageSize: number;
  /** Comma-separated statuses (API `csvEnum`). */
  status?: string | undefined;
  employeeId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export const claimQueries = {
  all: () => ['reimbursements'] as const,
  list: (p: ClaimListParams) =>
    queryOptions({
      queryKey: [...claimQueries.all(), 'list', p],
      // `summary` is present for `reimbursement.read.all` readers only.
      queryFn: () => api.get<ClaimList>('/reimbursement-claims', { query: { ...p } }),
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...claimQueries.all(), 'detail', id],
      queryFn: () => api.get<ReimbursementClaim>(`/reimbursement-claims/${id}`),
    }),
};

/** Claim changes also change the approval inbox and "my requests" (USER-FLOWS 6). */
function useClaimMutation<V, R>(fn: (v: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: claimQueries.all() }),
        queryClient.invalidateQueries({ queryKey: ['approvals'] }),
      ]),
  });
}

export const useCreateClaim = () =>
  useClaimMutation((v: CreateClaimInput) => api.post<ReimbursementClaim>('/reimbursement-claims', v));
export const useUpdateClaim = () =>
  useClaimMutation(({ id, ...v }: UpdateClaimInput & { id: string }) =>
    api.patch<ReimbursementClaim>(`/reimbursement-claims/${id}`, v),
  );
export const useDeleteClaim = () => useClaimMutation((id: string) => api.del(`/reimbursement-claims/${id}`));
export const useSubmitClaim = () =>
  useClaimMutation(({ id, version }: { id: string; version: number }) =>
    api.post<ReimbursementClaim>(`/reimbursement-claims/${id}/submit`, { version }),
  );
export const useWithdrawClaim = () =>
  useClaimMutation(({ id, version }: { id: string; version: number }) =>
    api.post<ReimbursementClaim>(`/reimbursement-claims/${id}/withdraw`, { version }),
  );
export const useApproveClaim = () =>
  useClaimMutation(
    ({ id, version, comment }: { id: string; version: number; comment?: string | undefined }) =>
      api.post<ReimbursementClaim>(`/reimbursement-claims/${id}/approve`, {
        version,
        ...(comment ? { comment } : {}),
      }),
  );
export const useRejectClaim = () =>
  useClaimMutation(({ id, version, comment }: { id: string; version: number; comment: string }) =>
    api.post<ReimbursementClaim>(`/reimbursement-claims/${id}/reject`, { version, comment }),
  );

/** Uploads a receipt as a `receipt` document of the caller's own record (API-CATALOGUE §9). */
export function uploadReceipt(employeeId: string, file: File, onProgress?: (fraction: number) => void) {
  const form = new FormData();
  form.append('category', 'receipt');
  form.append('title', `Receipt: ${file.name}`.slice(0, 200));
  form.append('file', file, file.name);
  return upload<DocumentDetail>(`/employees/${employeeId}/documents`, form, onProgress ? { onProgress } : {});
}

export const CLAIM_STATUS_ORDER: ClaimStatus[] = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'withdrawn',
  'included',
  'paid',
];
