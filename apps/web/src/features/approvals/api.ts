import type { ApprovalDetail, ApprovalSubjectType, ApprovalSummary } from '@hrm/contracts';
import { queryOptions } from '@tanstack/react-query';
import { api } from '../../lib/api/client';

export interface ApprovalListParams {
  page: number;
  pageSize: number;
  subjectType?: ApprovalSubjectType | undefined;
}

type Page<T> = { data: T[]; page: { number: number; size: number; totalItems: number; totalPages: number } };

export const approvalQueries = {
  all: () => ['approvals'] as const,
  inbox: (p: ApprovalListParams) =>
    queryOptions({
      queryKey: [...approvalQueries.all(), 'inbox', p],
      queryFn: () => api.get<Page<ApprovalSummary>>('/approvals/inbox', { query: { ...p } }),
    }),
  mine: (p: ApprovalListParams) =>
    queryOptions({
      queryKey: [...approvalQueries.all(), 'mine', p],
      queryFn: () => api.get<Page<ApprovalSummary>>('/approvals/mine', { query: { ...p } }),
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...approvalQueries.all(), 'detail', id],
      queryFn: () => api.get<ApprovalDetail>(`/approvals/${id}`),
    }),
};

export const SUBJECT_LABEL: Record<ApprovalSubjectType, string> = {
  leave_request: 'Leave request',
  attendance_correction: 'Attendance correction',
  reimbursement_claim: 'Claim',
  profile_change: 'Profile change',
  payroll_run: 'Payroll run',
  payroll_adjustment: 'Payroll adjustment',
};

/** Where the subject's own page lives (decisions are made there, API-CATALOGUE §10). */
export function subjectPath(type: ApprovalSubjectType, id: string): string {
  switch (type) {
    case 'leave_request':
      return `/leave/requests/${id}`;
    case 'reimbursement_claim':
      return `/reimbursements/${id}`;
    case 'payroll_run':
      return `/payroll/runs/${id}`;
    case 'payroll_adjustment':
      return '/payroll/adjustments';
    case 'attendance_correction':
      return `/attendance/corrections/${id}`;
    case 'profile_change':
      return `/employees/profile-changes/${id}`;
  }
}
