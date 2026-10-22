import type { LeaveReportRow, LeaveType } from '@hrm/contracts';
import { Select } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { PageHeader } from '../../components/page-header';
import { api } from '../../lib/api/client';
import { formatDays, todayIso } from '../../lib/format';
import { reportQueries } from './api';
import { employeeColumns, type ReportColumn } from './columns';
import { DepartmentFilter, YearFilter } from './filters';
import { FilterField, ReportView } from './ReportView';

const route = getRouteApi('/_app/reports/leave');

const qty = (key: keyof LeaveReportRow, header: string): ReportColumn<LeaveReportRow> => ({
  key,
  header,
  // Leave quantities are decimal strings ("1.50"); the XLSX writes them as numbers without converting in JS.
  type: 'money',
  numeric: true,
  value: (r) => r[key] as string,
  render: (r) => formatDays(r[key] as string),
});

const columns: ReportColumn<LeaveReportRow>[] = [
  ...employeeColumns<LeaveReportRow>(),
  { key: 'leaveType', header: 'Leave type', width: 18, value: (r) => r.leaveTypeName },
  qty('entitled', 'Entitled'),
  qty('used', 'Used'),
  qty('reserved', 'Reserved'),
  qty('adjusted', 'Adjusted'),
  qty('available', 'Available'),
  qty('takenInPeriod', 'Taken in period'),
];

// FR-REP-002: leave balances per employee and type for a leave year.
export function LeaveReportPage() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/reports/leave' });
  const query = useQuery(reportQueries.page<LeaveReportRow, undefined>('leave', search));
  const types = useQuery({
    queryKey: ['leave', 'types'],
    queryFn: () => api.get<{ data: LeaveType[] }>('/leave/types').then((r) => r.data),
  });
  const set = (patch: Partial<typeof search>) => void navigate({ search: { ...search, ...patch, page: 1 } });
  const thisYear = Number(todayIso().slice(0, 4));
  return (
    <>
      <PageHeader
        title="Leave report"
        breadcrumb={{ label: 'Reports', to: '/reports' }}
        description="Entitlement, use and balance per employee and leave type for the leave year."
      />
      <ReportView
        report="leave"
        title="Leave report"
        query={query}
        params={search}
        columns={columns}
        fileName={`leave-${search.year}`}
        rowKey={(r) => `${r.employeeId}-${r.leaveTypeId}`}
        stats={(d) => [
          { label: 'Balances', value: d.page.totalItems.toLocaleString('en-US') },
          { label: 'Leave year', value: search.year },
        ]}
        filtered={search.year !== thisYear || Boolean(search.leaveTypeId || search.departmentId)}
        onReset={() => void navigate({ search: { page: 1, pageSize: search.pageSize, year: thisYear } })}
        onPage={(page) => void navigate({ search: { ...search, page } })}
        onPageSize={(pageSize) => void navigate({ search: { ...search, page: 1, pageSize } })}
        filters={
          <>
            <YearFilter value={search.year} onChange={(year) => set({ year })} />
            <FilterField label="Leave type">
              {(id) => (
                <Select
                  id={id}
                  className="w-48"
                  value={search.leaveTypeId ?? ''}
                  onChange={(e) => set({ leaveTypeId: e.target.value || undefined })}
                >
                  <option value="">All leave types</option>
                  {(types.data ?? []).map((lt) => (
                    <option key={lt.id} value={lt.id}>
                      {lt.name}
                    </option>
                  ))}
                </Select>
              )}
            </FilterField>
            <DepartmentFilter
              value={search.departmentId}
              onChange={(departmentId) => set({ departmentId })}
            />
          </>
        }
      />
    </>
  );
}
