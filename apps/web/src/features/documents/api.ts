import type {
  DeleteDocumentInput,
  Document,
  DocumentCategory,
  DocumentDetail,
  DocumentListQuery,
} from '@hrm/contracts';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import { upload } from '../../lib/api/upload';

type Page<T> = { data: T[]; page: { number: number; size: number; totalItems: number; totalPages: number } };

export type DocumentListParams = Pick<DocumentListQuery, 'page' | 'pageSize'> & {
  category?: DocumentCategory | undefined;
};

export const documentQueries = {
  all: () => ['documents'] as const,
  employee: (employeeId: string, p: DocumentListParams) =>
    queryOptions({
      queryKey: [...documentQueries.all(), 'employee', employeeId, p],
      queryFn: () => api.get<Page<Document>>(`/employees/${employeeId}/documents`, { query: { ...p } }),
    }),
  company: (p: DocumentListParams) =>
    queryOptions({
      queryKey: [...documentQueries.all(), 'company', p],
      queryFn: () => api.get<Page<Document>>('/company/documents', { query: { ...p } }),
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...documentQueries.all(), 'detail', id],
      queryFn: () => api.get<DocumentDetail>(`/documents/${id}`),
    }),
};

/** The browser saves the file from this URL (USER-FLOWS 9.2); no file data passes through JavaScript. */
export const downloadUrl = (id: string, version?: number) =>
  `/api/v1/documents/${id}/download${version ? `?version=${version}` : ''}`;

export const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  identity: 'Identity',
  contract: 'Contract',
  certificate: 'Certificate',
  payslip: 'Payslip',
  receipt: 'Receipt',
  policy: 'Policy',
  other: 'Other',
};

export interface UploadFields {
  category: DocumentCategory;
  title: string;
  issueDate?: string | undefined;
  expiryDate?: string | undefined;
  isRestricted?: boolean | undefined;
}

function toForm(file: File, fields: Record<string, string | boolean | undefined>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== '') form.append(k, String(v));
  }
  form.append('file', file, file.name);
  return form;
}

export interface UploadVars {
  file: File;
  onProgress?: (fraction: number) => void;
}

/** Upload to an employee record, or to the company when `employeeId` is null (API-CATALOGUE §9). */
export function useUploadDocument(employeeId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, onProgress, fields }: UploadVars & { fields: UploadFields }) =>
      upload<DocumentDetail>(
        employeeId ? `/employees/${employeeId}/documents` : '/company/documents',
        toForm(file, { ...fields }),
        onProgress ? { onProgress } : {},
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: documentQueries.all() }),
  });
}

export function useAddVersion(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      file,
      onProgress,
      fields,
    }: UploadVars & { fields: { issueDate?: string | undefined; expiryDate?: string | undefined } }) =>
      upload<DocumentDetail>(
        `/documents/${documentId}/versions`,
        toForm(file, fields),
        onProgress ? { onProgress } : {},
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: documentQueries.all() }),
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: DeleteDocumentInput & { id: string }) =>
      api.post<DocumentDetail>(`/documents/${id}/delete`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: documentQueries.all() }),
  });
}
