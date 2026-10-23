import { claimStatusValues, type EmployeeBasic } from '@hrm/contracts';
import {
  Button,
  EmptyState,
  Input,
  LoadingBlock,
  Pagination,
  Select,
  StatBar,
  TableContainer,
} from '@hrm/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { Receipt } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { PageHeader } from '../../components/page-header';
import { api } from '../../lib/api/client';
import { useCan } from '../../lib/auth/me';
import { formatMoney } from '../../lib/format';
import { claimQueries } from './api';
import { ClaimsTable } from './ClaimsTable';

const route = getRouteApi('/_app/reimbursements/manage');

/** Employees for the filter select; only readers of every record get it (`employee.read.all`). */
export function useEmployeeOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () =>
      api.get<{ data: EmployeeBasic[] }>('/employees', { query: { pageSize: 100, sort: 'employeeCode' } }),
    enabled,
    staleTime: 5 * 60_000,
  });
}

// SCREEN-INVENTORY 5.4: every claim, filtered by status, employee and date of travel; filters live in the URL.
export function ManageClaimsPage() {
  const { t } = useTranslation();
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/reimbursements/manage' });
  const employees = useEmployeeOptions(useCan('employee.read.all'));
  const list = useQuery({ ...claimQueries.list(search), placeholderData: keepPreviousData });
  const filtered = Boolean(search.status || search.employeeId || search.from || search.to);
  const setFilter = (patch: Partial<typeof search>) =>
    void navigate({ search: { ...search, ...patch, page: 1 } });
  const reset = () => void navigate({ search: { page: 1, pageSize: search.pageSize } });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Claims"
        description="Transport claims from every employee. Open a claim to review it."
      />
      {list.data?.summary ? (
        <StatBar
          stats={[
            {
              label: 'Approved, not yet in payroll',
              value: list.data.summary.approvedNotIncluded.count.toLocaleString('en-US'),
            },
            {
              label: 'Amount waiting for payroll',
              value: (
                <span className="font-mono tabular-nums">
                  {formatMoney(list.data.summary.approvedNotIncluded.amount.amount)}
                </span>
              ),
            },
          ]}
        />
      ) : null}
      <TableContainer
        toolbar={
          <>
            <Select
              aria-label="Status"
              className="w-44"
              value={search.status ?? ''}
              onChange={(e) => setFilter({ status: (e.target.value || undefined) as never })}
            >
              <option value="">All statuses</option>
              {claimStatusValues.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
            {employees.data ? (
              <Select
                aria-label="Employee"
                className="w-60"
                value={search.employeeId ?? ''}
                onChange={(e) => setFilter({ employeeId: e.target.value || undefined })}
              >
                <option value="">All employees</option>
                {employees.data.data.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.displayName} · {e.employeeCode}
                  </option>
                ))}
              </Select>
            ) : null}
            <label htmlFor="claims-from" className="text-sm text-text-2">
              From
            </label>
            <Input
              id="claims-from"
              type="date"
              className="w-40"
              value={search.from ?? ''}
              max={search.to}
              onChange={(e) => setFilter({ from: e.target.value || undefined })}
            />
            <label htmlFor="claims-to" className="text-sm text-text-2">
              To
            </label>
            <Input
              id="claims-to"
              type="date"
              className="w-40"
              value={search.to ?? ''}
              min={search.from}
              onChange={(e) => setFilter({ to: e.target.value || undefined })}
            />
            {filtered ? (
              <Button variant="text" onClick={reset}>
                Reset filters
              </Button>
            ) : null}
          </>
        }
      >
        {list.isPending ? (
          <div className="p-4">
            <LoadingBlock label="Loading claims" />
          </div>
        ) : list.isError ? (
          <LoadError thing="claims" error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.data.data.length ? (
          <EmptyState
            icon={Receipt}
            variant={filtered ? 'no-results' : 'first-use'}
            title={filtered ? 'No results' : 'No claims yet'}
            description={
              filtered
                ? 'Try fewer filters or different dates.'
                : 'Claims appear here once employees submit them.'
            }
            action={
              filtered ? (
                <Button variant="secondary" onClick={reset}>
                  Reset filters
                </Button>
              ) : undefined
            }
            className="border-0"
          />
        ) : (
          <div aria-busy={list.isFetching} className={list.isPlaceholderData ? 'opacity-60' : undefined}>
            <ClaimsTable claims={list.data.data} caption="All claims" showEmployee />
            <div className="border-t border-line px-4 py-2">
              <Pagination
                page={list.data.page.number}
                pageSize={list.data.page.size}
                totalItems={list.data.page.totalItems}
                onPage={(page) => void navigate({ search: { ...search, page } })}
                onPageSize={(pageSize) => void navigate({ search: { ...search, page: 1, pageSize } })}
              />
            </div>
          </div>
        )}
      </TableContainer>
    </div>
  );
}
