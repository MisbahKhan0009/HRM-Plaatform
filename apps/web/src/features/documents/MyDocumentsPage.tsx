import { Button, EmptyState, LoadingBlock, Pagination, TableContainer } from '@hrm/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { FileText, Plus } from 'lucide-react';
import { useState } from 'react';
import { LoadError } from '../../components/load-error';
import { PageHeader } from '../../components/page-header';
import { useCan, useMe } from '../../lib/auth/me';
import { documentQueries } from './api';
import { DocumentsTable } from './DocumentsTable';
import { UploadDocumentDialog } from './UploadDocumentDialog';

const route = getRouteApi('/_app/documents');

// SCREEN-INVENTORY 6.3, canvas Documents.dc.html: the caller's own visible documents plus company policies.
export function MyDocumentsPage() {
  const me = useMe();
  const employeeId = me?.employee?.id ?? null;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="My documents"
        description="Documents HR has shared with you. Files are private and every download is checked against your access."
      />
      {employeeId ? <OwnDocuments employeeId={employeeId} /> : null}
      <CompanyDocuments />
      <p className="max-w-3xl text-sm text-text-2">
        Restricted documents, such as your national ID scan, are held by HR and aren't listed here. Payslips
        are under My payslips.
      </p>
    </div>
  );
}

function OwnDocuments({ employeeId }: { employeeId: string }) {
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/documents' });
  const list = useQuery({
    ...documentQueries.employee(employeeId, { page: search.page, pageSize: search.pageSize }),
    placeholderData: keepPreviousData,
  });
  return (
    <section aria-labelledby="own-docs" className="flex flex-col gap-3">
      <h2 id="own-docs" className="sr-only">
        Your documents
      </h2>
      <TableContainer>
        {list.isPending ? (
          <div className="p-4">
            <LoadingBlock label="Loading documents" />
          </div>
        ) : list.isError ? (
          <LoadError thing="your documents" error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.data.data.length ? (
          <EmptyState
            icon={FileText}
            title="No documents yet"
            description="HR adds documents such as your contract here."
            className="border-0"
          />
        ) : (
          <div aria-busy={list.isFetching}>
            <DocumentsTable documents={list.data.data} caption="Your documents" />
            {list.data.page.totalItems > list.data.page.size ? (
              <div className="border-t border-line px-4 py-2">
                <Pagination
                  page={list.data.page.number}
                  pageSize={list.data.page.size}
                  totalItems={list.data.page.totalItems}
                  onPage={(page) => void navigate({ search: { ...search, page } })}
                />
              </div>
            ) : null}
          </div>
        )}
      </TableContainer>
    </section>
  );
}

function CompanyDocuments() {
  const canManage = useCan('document.manage');
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const list = useQuery({
    ...documentQueries.company({ page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  if (!canManage && list.data && !list.data.data.length) return null;
  return (
    <section aria-labelledby="company-docs" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="company-docs" className="font-display text-xl font-semibold">
          Company policies
        </h2>
        {canManage ? (
          <Button variant="secondary" icon={<Plus aria-hidden="true" />} onClick={() => setUploading(true)}>
            Upload company document
          </Button>
        ) : null}
      </div>
      <TableContainer>
        {list.isPending ? (
          <div className="p-4">
            <LoadingBlock label="Loading company documents" rows={2} />
          </div>
        ) : list.isError ? (
          <LoadError thing="company documents" error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.data.data.length ? (
          <EmptyState
            icon={FileText}
            variant="no-results"
            title="No company documents yet"
            description="Policies shared with everyone, such as the code of conduct, appear here."
            className="border-0"
          />
        ) : (
          <div aria-busy={list.isFetching}>
            <DocumentsTable documents={list.data.data} caption="Company documents" canManage={canManage} />
            {list.data.page.totalItems > list.data.page.size ? (
              <div className="border-t border-line px-4 py-2">
                <Pagination
                  page={list.data.page.number}
                  pageSize={list.data.page.size}
                  totalItems={list.data.page.totalItems}
                  onPage={setPage}
                />
              </div>
            ) : null}
          </div>
        )}
      </TableContainer>
      {uploading ? <UploadDocumentDialog employeeId={null} onClose={() => setUploading(false)} /> : null}
    </section>
  );
}
