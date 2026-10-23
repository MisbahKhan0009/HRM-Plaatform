import { Button, LoadingBlock, TableContainer } from '@hrm/ui';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { Suspense, useState } from 'react';
import { PageHeader } from '../../../components/page-header';
import { attendanceQueries } from '../../../features/attendance/api';
import { ManualEntryDialog } from '../../../features/attendance/manual-entry-dialog';
import { recordsSearch } from '../../../features/attendance/records-search';
import { RecordsFilters, RecordsTable } from '../../../features/attendance/records-table';
import { requireAny, useCan } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/attendance/records')({
  validateSearch: recordsSearch,
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['attendance.read.all']),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(attendanceQueries.list(deps)),
  pendingComponent: () => <LoadingBlock label="attendance records" />,
  component: AttendanceRecordsPage,
});

// SCREEN-INVENTORY §3.3: every employee's days, with manual entry for HR (FR-ATT-009).
function AttendanceRecordsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const canManage = useCan('attendance.manage');
  const [adding, setAdding] = useState(false);
  const onSearch = (patch: Partial<typeof search>) => void navigate({ search: { ...search, ...patch } });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Attendance records"
        description="Every employee's days. Original check-ins are kept; corrections and manual entries are added beside them."
        actions={
          canManage ? (
            <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => setAdding(true)}>
              Add manual entry
            </Button>
          ) : null
        }
      />
      <TableContainer
        toolbar={<RecordsFilters search={search} showDepartment onSearch={onSearch} />}
        footer={<p className="text-sm text-text-2">Times in Asia/Dhaka.</p>}
      >
        <Suspense fallback={<LoadingBlock label="records" />}>
          <RecordsTable search={search} onSearch={onSearch} />
        </Suspense>
      </TableContainer>
      {adding ? <ManualEntryDialog onClose={() => setAdding(false)} /> : null}
    </div>
  );
}
