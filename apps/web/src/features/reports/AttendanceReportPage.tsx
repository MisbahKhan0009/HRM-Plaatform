import type { AttendanceReportRow } from '@hrm/contracts';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { PageHeader } from '../../components/page-header';
import { formatDateRange, formatDuration } from '../../lib/format';
import { reportQueries } from './api';
import { employeeColumns, type ReportColumn } from './columns';
import { currentMonth, DateFilter, DepartmentFilter } from './filters';
import { ReportView } from './ReportView';

const route = getRouteApi('/_app/reports/attendance');

const count = (
  key: keyof AttendanceReportRow['days'],
  header: string,
): ReportColumn<AttendanceReportRow> => ({
  key,
  header,
  type: 'integer',
  numeric: true,
  value: (r) => r.days[key],
});

const columns: ReportColumn<AttendanceReportRow>[] = [
  ...employeeColumns<AttendanceReportRow>(),
  count('present', 'Present'),
  count('shortHours', 'Short hours'),
  count('missedCore', 'Missed core'),
  count('missingPunch', 'Missing punch'),
  count('absent', 'Absent'),
  count('onLeave', 'On leave'),
  count('holiday', 'Holiday'),
  count('weekend', 'Weekend'),
  {
    key: 'worked',
    header: 'Worked (minutes)',
    type: 'integer',
    numeric: true,
    value: (r) => r.workedMinutes,
    render: (r) => formatDuration(r.workedMinutes),
  },
  { key: 'late', header: 'Late (minutes)', type: 'integer', numeric: true, value: (r) => r.lateMinutes },
  {
    key: 'early',
    header: 'Left early (minutes)',
    type: 'integer',
    numeric: true,
    value: (r) => r.earlyLeaveMinutes,
  },
  { key: 'review', header: 'Needs review', type: 'integer', numeric: true, value: (r) => r.needsReview },
];

// FR-REP-002, FR-ATT-011: day counts and worked time per employee for a period of at most 366 days.
export function AttendanceReportPage() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/reports/attendance' });
  const query = useQuery(reportQueries.page<AttendanceReportRow, undefined>('attendance', search));
  const set = (patch: Partial<typeof search>) => void navigate({ search: { ...search, ...patch, page: 1 } });
  const month = currentMonth();
  return (
    <>
      <PageHeader
        title="Attendance report"
        breadcrumb={{ label: 'Reports', to: '/reports' }}
        description="Day counts and worked time per employee. Leave and holidays are counted separately."
      />
      <ReportView
        report="attendance"
        title="Attendance report"
        query={query}
        params={search}
        columns={columns}
        fileName={`attendance-${search.from}-${search.to}`}
        rowKey={(r) => r.employeeId}
        stats={(d) => [
          { label: 'Employees', value: d.page.totalItems.toLocaleString('en-US') },
          {
            label: 'Period',
            value: <span className="text-xl">{formatDateRange(search.from, search.to)}</span>,
          },
        ]}
        filtered={search.from !== month.from || search.to !== month.to || Boolean(search.departmentId)}
        onReset={() => void navigate({ search: { page: 1, pageSize: search.pageSize, ...month } })}
        onPage={(page) => void navigate({ search: { ...search, page } })}
        onPageSize={(pageSize) => void navigate({ search: { ...search, page: 1, pageSize } })}
        filters={
          <>
            <DateFilter
              label="From"
              value={search.from}
              max={search.to}
              onChange={(from) => from && set({ from })}
            />
            <DateFilter label="To" value={search.to} min={search.from} onChange={(to) => to && set({ to })} />
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
