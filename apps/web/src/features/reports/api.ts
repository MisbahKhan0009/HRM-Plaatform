import type { ReportExportInput, ReportName } from '@hrm/contracts';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api } from '../../lib/api/client';

export type PageMeta = { number: number; size: number; totalItems: number; totalPages: number };
export type ReportResult<Row, Summary = undefined> = { data: Row[]; page: PageMeta; summary: Summary };

export type ReportParams = Record<string, string | number | undefined>;

/** API path of each report (API-CATALOGUE §12). */
export const REPORT_PATH: Record<ReportName, string> = {
  headcount: '/reports/headcount',
  directory: '/reports/directory',
  attendance: '/reports/attendance',
  leave: '/reports/leave',
  payroll_register: '/reports/payroll-register',
  payroll_deductions: '/reports/payroll-deductions',
  payment_reconciliation: '/reports/payment-reconciliation',
  reimbursements: '/reports/reimbursements',
};

export const reportQueries = {
  all: () => ['reports'] as const,
  page: <Row, Summary>(report: ReportName, params: ReportParams, enabled = true) =>
    queryOptions({
      queryKey: [...reportQueries.all(), report, params],
      queryFn: () => api.get<ReportResult<Row, Summary>>(REPORT_PATH[report], { query: params }),
      placeholderData: keepPreviousData,
      enabled,
    }),
};

const EXPORT_PAGE_SIZE = 100;

/**
 * Every page of a report for the current filters, fetched one after another (TABLES-AND-LISTS §6) so the API applies
 * its scope to each page exactly as on screen. Cancel through the signal.
 */
export async function fetchAllRows<Row>(
  report: ReportName,
  params: ReportParams,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<Row[]> {
  const rows: Row[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await api.get<ReportResult<Row, unknown>>(REPORT_PATH[report], {
      query: { ...params, page, pageSize: EXPORT_PAGE_SIZE },
      signal,
    });
    rows.push(...res.data);
    totalPages = Math.max(1, res.page.totalPages);
    onProgress(page, totalPages);
    page += 1;
  } while (page <= totalPages);
  return rows;
}

/** FR-REP-005: every export is written to the audit log before the file is built (D-037). */
export const auditExport = (input: ReportExportInput) => api.post<void>('/reports/exports', input);

/** The filters of an export as the audit log stores them: no paging, no empty values. */
export function exportFilters(params: ReportParams): ReportExportInput['filters'] {
  const filters: ReportExportInput['filters'] = {};
  for (const [k, v] of Object.entries(params)) {
    if (k === 'page' || k === 'pageSize' || v === undefined || v === '') continue;
    filters[k] = v;
  }
  return filters;
}
