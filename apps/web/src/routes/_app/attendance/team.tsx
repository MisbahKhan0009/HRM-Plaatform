import { LoadingBlock, StatBar, TableContainer } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Suspense } from 'react';
import { PageHeader } from '../../../components/page-header';
import { attendanceQueries } from '../../../features/attendance/api';
import { recordsSearch } from '../../../features/attendance/records-search';
import { RecordsFilters, RecordsTable } from '../../../features/attendance/records-table';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/attendance/team')({
  validateSearch: recordsSearch,
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['attendance.read.team']),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(attendanceQueries.list(deps)),
  pendingComponent: () => <LoadingBlock label="team attendance" />,
  component: TeamAttendancePage,
});

// SCREEN-INVENTORY §3.2. Lateness is shown for awareness only (D-010).
function TeamAttendancePage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const summary = useQuery(attendanceQueries.summary({ from: search.from, to: search.to }));
  const total = (key: 'present' | 'on_leave' | 'absent' | 'missing_punch') =>
    summary.data ? summary.data.data.reduce((n, r) => n + r.counts[key], 0) : '—';
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team attendance"
        description="Your direct and indirect reports. Lateness is shown for awareness only and never affects pay."
      />
      <StatBar
        stats={[
          { label: 'Present days', value: total('present') },
          { label: 'On leave', value: total('on_leave') },
          { label: 'Absent', value: total('absent') },
          { label: 'Missing punch', value: total('missing_punch') },
        ]}
      />
      <TableContainer
        toolbar={
          <RecordsFilters
            search={search}
            showDepartment={false}
            onSearch={(patch) => void navigate({ search: { ...search, ...patch } })}
          />
        }
        footer={
          <p className="text-sm text-text-2">
            Times in Asia/Dhaka. Absent is set when the day closes after midnight.
          </p>
        }
      >
        <Suspense fallback={<LoadingBlock label="records" />}>
          <RecordsTable
            search={search}
            onSearch={(patch) => void navigate({ search: { ...search, ...patch } })}
          />
        </Suspense>
      </TableContainer>
    </div>
  );
}
