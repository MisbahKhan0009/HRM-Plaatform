import { approvalSubjectTypeValues } from '@hrm/contracts';
import {
  Button,
  EmptyState,
  LoadingBlock,
  Pagination,
  Select,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Inbox } from 'lucide-react';
import { Suspense } from 'react';
import { z } from 'zod';
import { PageHeader } from '../../../components/page-header';
import { approvalQueries, SUBJECT_LABEL } from '../../../features/approvals/api';
import { requireAny } from '../../../lib/auth/me';
import { formatRelative } from '../../../lib/format';

const search = z.object({
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(25).catch(25),
  subjectType: z.enum(approvalSubjectTypeValues).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/approvals/')({
  validateSearch: search,
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['approval.inbox']),
  loaderDeps: ({ search: s }) => s,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(approvalQueries.inbox(deps)),
  pendingComponent: () => <LoadingBlock label="approvals" />,
  component: ApprovalsPage,
});

// INFORMATION-ARCHITECTURE §1 `/approvals`; COMPONENT-SPECS §15. Decisions happen on the subject's page.
function ApprovalsPage() {
  const params = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Approvals"
        description="Requests waiting for your decision, oldest first in each type."
      />
      <TableContainer
        toolbar={
          <Select
            aria-label="Request type"
            className="w-56"
            value={params.subjectType ?? ''}
            onChange={(e) =>
              void navigate({
                search: { ...params, page: 1, subjectType: (e.target.value || undefined) as never },
              })
            }
          >
            <option value="">All request types</option>
            {approvalSubjectTypeValues.map((v) => (
              <option key={v} value={v}>
                {SUBJECT_LABEL[v]}
              </option>
            ))}
          </Select>
        }
      >
        <Suspense fallback={<LoadingBlock label="approvals" />}>
          <InboxTable />
        </Suspense>
      </TableContainer>
    </div>
  );
}

function InboxTable() {
  const params = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data } = useSuspenseQuery(approvalQueries.inbox(params));
  if (!data.data.length) {
    return (
      <EmptyState
        icon={Inbox}
        title="Nothing is waiting for you"
        description="New requests from your team will appear here."
        className="border-0"
      />
    );
  }
  return (
    <>
      <Table>
        <THead>
          <tr>
            <TH>Type</TH>
            <TH>Employee</TH>
            <TH>Requested by</TH>
            <TH>Submitted</TH>
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {data.data.map((a) => (
            <TR key={a.id}>
              <TD className="font-mono text-[11px] uppercase tracking-[0.13em] text-text-2">
                {SUBJECT_LABEL[a.subjectType]}
              </TD>
              <TD>
                {a.subjectEmployee ? (
                  <>
                    {a.subjectEmployee.name}{' '}
                    <span className="font-mono text-sm text-text-2">{a.subjectEmployee.employeeCode}</span>
                  </>
                ) : (
                  '—'
                )}
              </TD>
              <TD>{a.requester.name}</TD>
              <TD title={a.createdAt}>{formatRelative(a.createdAt)}</TD>
              <TD className="text-right">
                <Button variant="text" asChild>
                  <Link to="/approvals/$approvalId" params={{ approvalId: a.id }}>
                    Review
                  </Link>
                </Button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <div className="border-t border-line px-4 py-2">
        <Pagination
          page={data.page.number}
          pageSize={data.page.size}
          totalItems={data.page.totalItems}
          onPage={(page) => void navigate({ search: { ...params, page } })}
          onPageSize={(pageSize) => void navigate({ search: { ...params, page: 1, pageSize } })}
        />
      </div>
    </>
  );
}
