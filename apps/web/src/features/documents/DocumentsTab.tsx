import { type DocumentCategory, documentCategoryValues } from '@hrm/contracts';
import { Button, EmptyState, LoadingBlock, Pagination, Select, TableContainer } from '@hrm/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';
import { useState } from 'react';
import { LoadError } from '../../components/load-error';
import { useCan } from '../../lib/auth/me';
import { CATEGORY_LABEL, documentQueries } from './api';
import { DocumentsTable } from './DocumentsTable';
import { UploadDocumentDialog } from './UploadDocumentDialog';

/**
 * Documents tab of the employee record (SCREEN-INVENTORY 8.4, USER-FLOWS 9): list, versions, download; upload, new
 * version and deletion with `document.manage`. Mount it on `/employees/$employeeId`.
 */
export function DocumentsTab({ employeeId, employeeName }: { employeeId: string; employeeName?: string }) {
  const canManage = useCan('document.manage');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [category, setCategory] = useState<DocumentCategory | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const list = useQuery({
    ...documentQueries.employee(employeeId, { page, pageSize, category }),
    placeholderData: keepPreviousData,
  });
  return (
    <section aria-labelledby="documents-tab-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="documents-tab-title" className="font-display text-xl font-semibold">
          Documents
        </h2>
        {canManage ? (
          <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => setUploading(true)}>
            Upload document
          </Button>
        ) : null}
      </div>
      <TableContainer
        toolbar={
          <Select
            aria-label="Category"
            className="w-48"
            value={category ?? ''}
            onChange={(e) => {
              setCategory((e.target.value || undefined) as DocumentCategory | undefined);
              setPage(1);
            }}
          >
            <option value="">All categories</option>
            {documentCategoryValues.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        }
      >
        {list.isPending ? (
          <div className="p-4">
            <LoadingBlock label="Loading documents" />
          </div>
        ) : list.isError ? (
          <LoadError thing="documents" error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.data.data.length ? (
          <EmptyState
            icon={FileText}
            variant={category ? 'no-results' : 'first-use'}
            title={category ? 'No results' : 'No documents yet'}
            description={
              category
                ? 'No documents in this category.'
                : 'Contracts, certificates and identity documents uploaded by HR appear here.'
            }
            className="border-0"
          />
        ) : (
          <div aria-busy={list.isFetching} className={list.isPlaceholderData ? 'opacity-60' : undefined}>
            <DocumentsTable
              documents={list.data.data}
              caption={employeeName ? `Documents of ${employeeName}` : 'Documents'}
              canManage={canManage}
            />
            <div className="border-t border-line px-4 py-2">
              <Pagination
                page={list.data.page.number}
                pageSize={list.data.page.size}
                totalItems={list.data.page.totalItems}
                onPage={setPage}
                onPageSize={(s) => {
                  setPageSize(s);
                  setPage(1);
                }}
              />
            </div>
          </div>
        )}
      </TableContainer>
      {uploading ? (
        <UploadDocumentDialog employeeId={employeeId} onClose={() => setUploading(false)} />
      ) : null}
    </section>
  );
}
