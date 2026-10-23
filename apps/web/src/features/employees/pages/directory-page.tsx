import { type EmployeeStatus, employeeStatusValues } from '@hrm/contracts';
import {
  Button,
  EmptyState,
  LoadingBlock,
  Pagination,
  SearchInput,
  Select,
  SortHeader,
  StatBar,
  StatusBadge,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { Plus, Upload, Users } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../../components/page-header';
import { useCan } from '../../../lib/auth/me';
import { formatDate } from '../../../lib/format';
import { type DirectorySearch, type DirectorySort, directoryQuery, employeeQueries } from '../api';
import { EmployeePicker } from '../components/employee-picker';
import { DepartmentPicker, PositionPicker } from '../components/org-pickers';

const route = getRouteApi('/_app/employees/');

// SCREEN-INVENTORY §8.1, canvas Employees: search, filters, sort and pagination live in the URL.
export function DirectoryPage() {
  const canManage = useCan('employee.manage');
  const canReport = useCan('report.hr');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Employees"
        description="Archived records keep their full history; filter by status to see them."
        actions={
          canManage ? (
            <>
              <Button variant="secondary" asChild>
                <Link to="/employees/import">
                  <Upload aria-hidden="true" />
                  Import CSV
                </Link>
              </Button>
              <Button variant="primary" asChild>
                <Link to="/employees/new">
                  <Plus aria-hidden="true" />
                  Add employee
                </Link>
              </Button>
            </>
          ) : null
        }
      />
      {canReport ? <Headcount /> : null}
      <TableContainer toolbar={<Filters />}>
        <Suspense
          fallback={
            <div className="p-4">
              <LoadingBlock label="employees" />
            </div>
          }
        >
          <DirectoryTable />
        </Suspense>
      </TableContainer>
    </div>
  );
}

function Headcount() {
  const { t } = useTranslation();
  const headcount = useQuery(employeeQueries.headcountByStatus());
  if (!headcount.data) return null;
  const count = (s: EmployeeStatus) => headcount.data.data.reduce((n, r) => n + (r.byStatus[s] ?? 0), 0);
  return (
    <StatBar
      stats={(['active', 'probation', 'notice_period', 'preboarding'] as const).map((s) => ({
        label: t(`status.${s}`),
        value: count(s),
      }))}
    />
  );
}

function Filters() {
  const { t } = useTranslation();
  const params = route.useSearch();
  const navigate = route.useNavigate();
  const [q, setQ] = useState(params.q ?? '');
  const set = (patch: Partial<DirectorySearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, page: 1 }), replace: true });

  // Debounced search: the URL follows the input 300 ms after typing stops.
  useEffect(() => {
    const current = params.q ?? '';
    if (q === current) return;
    const timer = window.setTimeout(
      () => void navigate({ search: (prev) => ({ ...prev, q: q || undefined, page: 1 }), replace: true }),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [q, params.q, navigate]);

  const filtered = Boolean(
    params.q || params.status || params.departmentId || params.positionId || params.managerId,
  );
  return (
    <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.4fr)_repeat(4,minmax(150px,1fr))_auto]">
      <SearchInput
        // The kit draws its own clear button; hide the browser's native one so there is only one.
        className="[&_input::-webkit-search-cancel-button]:appearance-none"
        aria-label="Search employees"
        placeholder="Search name, code or email"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onClear={() => setQ('')}
      />
      <Select
        aria-label="Status"
        value={params.status ?? ''}
        onChange={(e) => set({ status: (e.target.value || undefined) as DirectorySearch['status'] })}
      >
        <option value="">Not archived</option>
        <option value="all">All statuses</option>
        {employeeStatusValues.map((s) => (
          <option key={s} value={s}>
            {t(`status.${s}`)}
          </option>
        ))}
      </Select>
      <DepartmentPicker
        aria-label="Department"
        placeholder="All departments"
        value={params.departmentId}
        onChange={(id) => set({ departmentId: id ?? undefined })}
      />
      <PositionPicker
        aria-label="Position"
        placeholder="All positions"
        value={params.positionId}
        onChange={(id) => set({ positionId: id ?? undefined })}
      />
      <EmployeePicker
        aria-label="Manager"
        placeholder="All managers"
        value={params.managerId}
        onChange={(id) => set({ managerId: id ?? undefined })}
      />
      {filtered ? (
        <Button
          variant="text"
          className="justify-self-start"
          onClick={() => {
            setQ('');
            void navigate({ search: (prev) => ({ page: 1, pageSize: prev.pageSize, sort: prev.sort }) });
          }}
        >
          Reset
        </Button>
      ) : null}
    </div>
  );
}

function DirectoryTable() {
  const { t } = useTranslation();
  const params = route.useSearch();
  const navigate = route.useNavigate();
  const canManage = useCan('employee.manage');
  const { data } = useSuspenseQuery(directoryQuery(params));
  const filtered = Boolean(
    params.q || params.status || params.departmentId || params.positionId || params.managerId,
  );

  if (!data.data.length) {
    return filtered ? (
      <EmptyState
        variant="no-results"
        icon={Users}
        title="No employees match"
        description="Change the search or filters, or reset them."
        className="border-0"
      />
    ) : (
      <EmptyState
        icon={Users}
        title="No employees yet"
        description="Add employees one by one or import a CSV file."
        className="border-0"
        action={
          canManage ? (
            <Button variant="secondary" asChild>
              <Link to="/employees/new">Add employee</Link>
            </Button>
          ) : null
        }
      />
    );
  }

  const sortBy = (field: 'lastName' | 'employeeCode' | 'joiningDate') => {
    const next: DirectorySort = params.sort === field ? `-${field}` : field;
    void navigate({ search: (prev) => ({ ...prev, sort: next, page: 1 }) });
  };
  const dir = (field: string) =>
    params.sort === field ? 'asc' : params.sort === `-${field}` ? ('desc' as const) : null;

  return (
    <>
      <ul className="flex flex-col divide-y divide-line sm:hidden" aria-label="Employees">
        {data.data.map((e) => (
          <li key={e.id}>
            <Link
              to="/employees/$employeeId"
              params={{ employeeId: e.id }}
              className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-ground-2"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{e.displayName}</span>
                <span className="font-mono text-sm text-text-2">{e.employeeCode}</span>
                <span className="truncate text-sm text-text-2">{e.position?.title ?? '—'}</span>
              </span>
              <StatusBadge status={e.status} label={t(`status.${e.status}`)} />
            </Link>
          </li>
        ))}
      </ul>
      <Table className="hidden sm:table">
        <THead>
          <tr>
            <SortHeader label="Code" direction={dir('employeeCode')} onSort={() => sortBy('employeeCode')} />
            <SortHeader label="Name" direction={dir('lastName')} onSort={() => sortBy('lastName')} />
            <TH>Department</TH>
            <TH>Position</TH>
            <TH>Manager</TH>
            <SortHeader label="Joined" direction={dir('joiningDate')} onSort={() => sortBy('joiningDate')} />
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {data.data.map((e) => (
            <TR key={e.id}>
              <TD className="font-mono text-sm whitespace-nowrap text-text-2">{e.employeeCode}</TD>
              <TD>
                <Link
                  to="/employees/$employeeId"
                  params={{ employeeId: e.id }}
                  className="font-medium text-link underline-offset-4 hover:underline"
                >
                  {e.displayName}
                </Link>
              </TD>
              <TD>{e.department?.name ?? '—'}</TD>
              <TD>{e.position?.title ?? '—'}</TD>
              <TD>{e.manager?.name ?? '—'}</TD>
              <TD className="whitespace-nowrap">{e.joiningDate ? formatDate(e.joiningDate) : '—'}</TD>
              <TD>
                <StatusBadge status={e.status} label={t(`status.${e.status}`)} />
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
          onPage={(page) => void navigate({ search: (prev) => ({ ...prev, page }) })}
          onPageSize={(pageSize) => void navigate({ search: (prev) => ({ ...prev, page: 1, pageSize }) })}
        />
      </div>
    </>
  );
}
