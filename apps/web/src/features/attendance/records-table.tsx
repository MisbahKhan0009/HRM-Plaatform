import { type AttendanceRecord, attendanceStatusValues } from '@hrm/contracts';
import {
  Button,
  Checkbox,
  EmptyState,
  Input,
  Pagination,
  Select,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CalendarSearch } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, formatDuration, formatShortDate, formatTime } from '../../lib/format';
import { orgQueries } from '../organization/api';
import { attendanceQueries } from './api';
import type { RecordsSearch } from './records-search';
import { RecordFlags } from './selected-day';

type Patch = Partial<RecordsSearch>;

/** Filters kept in the URL (TABLES-AND-LISTS): range, employee, department, status, needs review. */
export function RecordsFilters({
  search,
  onSearch,
  showDepartment,
}: {
  search: RecordsSearch;
  onSearch: (patch: Patch) => void;
  showDepartment: boolean;
}) {
  const { t } = useTranslation();
  // Employees with records in the range: the only ones a filter can match.
  const employees = useQuery(attendanceQueries.summary({ from: search.from, to: search.to }));
  const departments = useQuery({ ...orgQueries.departments(), enabled: showDepartment });
  const set = (patch: Patch) => onSearch({ ...patch, page: 1 });
  return (
    <div className="flex w-full flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1 text-sm font-medium">
        <label htmlFor="records-from">From</label>
        <Input
          id="records-from"
          type="date"
          className="w-40"
          value={search.from}
          onChange={(e) => e.target.value && set({ from: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1 text-sm font-medium">
        <label htmlFor="records-to">To</label>
        <Input
          id="records-to"
          type="date"
          className="w-40"
          value={search.to}
          onChange={(e) => e.target.value && set({ to: e.target.value })}
        />
      </div>
      <Select
        aria-label="Employee"
        className="w-56"
        value={search.employeeId ?? ''}
        onChange={(e) => set({ employeeId: e.target.value || undefined })}
      >
        <option value="">All employees</option>
        {employees.data?.data.map((r) => (
          <option key={r.employee.id} value={r.employee.id}>
            {r.employee.name} · {r.employee.employeeCode}
          </option>
        ))}
      </Select>
      {showDepartment ? (
        <Select
          aria-label="Department"
          className="w-48"
          value={search.departmentId ?? ''}
          onChange={(e) => set({ departmentId: e.target.value || undefined })}
        >
          <option value="">All departments</option>
          {departments.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      ) : null}
      <Select
        aria-label="Status"
        className="w-48"
        value={search.status ?? ''}
        onChange={(e) => set({ status: (e.target.value || undefined) as RecordsSearch['status'] })}
      >
        <option value="">All statuses</option>
        {attendanceStatusValues.map((s) => (
          <option key={s} value={s}>
            {t(`status.${s}`)}
          </option>
        ))}
      </Select>
      <Checkbox
        className="h-10"
        label="Needs review"
        checked={search.needsReview === true}
        onChange={(e) => set({ needsReview: e.target.checked ? true : undefined })}
      />
    </div>
  );
}

function DayLink({ r, children }: { r: AttendanceRecord; children: ReactNode }) {
  return (
    <Link
      to="/attendance/$employeeId/$workDate"
      params={{ employeeId: r.employee.id, workDate: r.workDate }}
      className="text-link underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  );
}

/** The records table (SCREEN-INVENTORY §3.2, §3.3); a card list on phones. */
export function RecordsTable({
  search,
  onSearch,
}: {
  search: RecordsSearch;
  onSearch: (patch: Patch) => void;
}) {
  const { t } = useTranslation();
  const { data } = useSuspenseQuery(attendanceQueries.list(search));
  if (!data.data.length) {
    return (
      <EmptyState
        icon={CalendarSearch}
        variant="no-results"
        title="No records match"
        description={`Nothing recorded from ${formatDate(search.from)} to ${formatDate(search.to)} with these filters. Days are recorded at the first check-in and closed after midnight.`}
        className="border-0"
      />
    );
  }
  const time = (v: string | null) => (v ? formatTime(v) : '—');
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <THead>
            <tr>
              <TH>Employee</TH>
              <TH>Date</TH>
              <TH>Status</TH>
              <TH>In</TH>
              <TH>Out</TH>
              <TH className="text-right">Worked</TH>
              <TH>Notes</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {data.data.map((r) => (
              <TR key={r.id}>
                <TD>
                  {r.employee.name}{' '}
                  <span className="font-mono text-sm text-text-2">{r.employee.employeeCode}</span>
                </TD>
                <TD className="whitespace-nowrap">
                  <time dateTime={r.workDate}>{formatShortDate(r.workDate)}</time>
                </TD>
                <TD>
                  <StatusBadge status={r.status} label={t(`status.${r.status}`)} />
                </TD>
                <TD className="font-mono tabular-nums whitespace-nowrap">{time(r.firstInAt)}</TD>
                <TD className="font-mono tabular-nums whitespace-nowrap">{time(r.lastOutAt)}</TD>
                <TD className="text-right font-mono tabular-nums">{formatDuration(r.workedMinutes)}</TD>
                <TD>
                  <RecordFlags record={r} />
                </TD>
                <TD className="text-right">
                  <Button variant="text" asChild>
                    <Link
                      to="/attendance/$employeeId/$workDate"
                      params={{ employeeId: r.employee.id, workDate: r.workDate }}
                      aria-label={`View ${r.employee.name} on ${formatDate(r.workDate)}`}
                    >
                      View
                    </Link>
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      <ul className="flex flex-col divide-y divide-line md:hidden">
        {data.data.map((r) => (
          <li key={r.id} className="flex flex-col gap-1.5 p-4">
            <div className="flex items-center justify-between gap-3">
              <DayLink r={r}>
                <span className="font-medium">{r.employee.name}</span>
              </DayLink>
              <StatusBadge status={r.status} label={t(`status.${r.status}`)} />
            </div>
            <p className="font-mono text-sm text-text-2 tabular-nums">
              {formatShortDate(r.workDate)} · {time(r.firstInAt)} to {time(r.lastOutAt)} ·{' '}
              {formatDuration(r.workedMinutes)}
            </p>
            <RecordFlags record={r} />
          </li>
        ))}
      </ul>
      <div className="border-t border-line px-4 py-2">
        <Pagination
          page={data.page.number}
          pageSize={data.page.size}
          totalItems={data.page.totalItems}
          onPage={(page) => onSearch({ page })}
          onPageSize={(pageSize) => onSearch({ page: 1, pageSize })}
        />
      </div>
    </>
  );
}
