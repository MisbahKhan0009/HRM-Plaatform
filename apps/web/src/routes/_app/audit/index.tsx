import { auditCategoryValues } from '@hrm/contracts';
import { Alert, Button, EmptyState, LoadingBlock, Pagination, TableContainer } from '@hrm/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ScrollText } from 'lucide-react';
import { Suspense, useState } from 'react';
import { z } from 'zod';
import { PageHeader } from '../../../components/page-header';
import { type AuditSearch, addDaysIso, auditQueries, rangeProblem } from '../../../features/audit/api';
import { AuditFilters, AuditTable, FilterChips } from '../../../features/audit/components';
import { requireAny } from '../../../lib/auth/me';
import { todayIso } from '../../../lib/format';

const isoDate = z.iso.date();
const uuid = z.uuid().optional().catch(undefined);

// Defaults are computed per parse so a tab left open overnight still opens on the last 7 days.
const search = z.object({
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(25).catch(25),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  action: z
    .string()
    .regex(/^[a-z_.]{1,80}$/)
    .optional()
    .catch(undefined),
  category: z.enum(auditCategoryValues).optional().catch(undefined),
  entityType: z
    .string()
    .regex(/^[a-z_]{1,60}$/)
    .optional()
    .catch(undefined),
  entityId: uuid,
  actorUserId: uuid,
  employeeId: uuid,
});

/** The search with the default range filled in: the last 7 days in Asia/Dhaka, today included. */
function withDefaults(s: z.infer<typeof search>): AuditSearch {
  const to = s.to ?? todayIso();
  return { ...s, to, from: s.from ?? addDaysIso(to, -6) };
}

export const Route = createFileRoute('/_app/audit/')({
  validateSearch: search,
  beforeLoad: ({ context }) =>
    requireAny(context.queryClient, ['audit.read.all', 'audit.read.payroll', 'audit.read.technical']),
  loaderDeps: ({ search: s }) => withDefaults(s),
  loader: ({ context, deps }) =>
    rangeProblem(deps.from, deps.to) ? null : context.queryClient.ensureQueryData(auditQueries.list(deps)),
  pendingComponent: () => <LoadingBlock label="audit log" />,
  component: AuditPage,
});

// INFORMATION-ARCHITECTURE §1 `/audit`, SCREEN-INVENTORY §10.3. Results are limited to the caller's categories.
function AuditPage() {
  const raw = Route.useSearch();
  const params = withDefaults(raw);
  const navigate = useNavigate({ from: Route.fullPath });
  const [names, setNames] = useState<Record<string, string>>({});
  const problem = rangeProblem(params.from, params.to);
  const filtered =
    raw.from ||
    raw.to ||
    raw.action ||
    raw.category ||
    raw.entityType ||
    raw.entityId ||
    raw.actorUserId ||
    raw.employeeId;
  const update = (patch: Partial<AuditSearch>, actorName?: string) => {
    if (actorName && patch.actorUserId) setNames((n) => ({ ...n, [patch.actorUserId as string]: actorName }));
    void navigate({ search: { ...params, ...patch, page: 1 } });
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit log"
        description="Every sensitive change, who made it and when. Entries can't be edited or deleted. Times are in Asia/Dhaka."
      />
      <AuditFilters search={params} onChange={update} />
      <div className="flex flex-wrap items-center gap-3">
        <FilterChips search={params} names={names} onChange={update} />
        {filtered ? (
          <Button variant="text" onClick={() => void navigate({ search: {} })}>
            Reset filters
          </Button>
        ) : null}
      </div>
      {problem ? (
        <Alert tone="warn">{problem}</Alert>
      ) : (
        <TableContainer>
          <Suspense fallback={<LoadingBlock label="audit log" />}>
            <Results params={params} onFilter={update} />
          </Suspense>
        </TableContainer>
      )}
    </div>
  );
}

function Results({
  params,
  onFilter,
}: {
  params: AuditSearch;
  onFilter: (patch: Partial<AuditSearch>, actorName?: string) => void;
}) {
  const navigate = useNavigate({ from: Route.fullPath });
  const { data } = useSuspenseQuery(auditQueries.list(params));
  if (!data.data.length) {
    return (
      <EmptyState
        icon={ScrollText}
        variant="no-results"
        title="No matching events"
        description="Change the dates or filters."
        className="border-0"
      />
    );
  }
  return (
    <>
      <AuditTable entries={data.data} onFilter={onFilter} />
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
