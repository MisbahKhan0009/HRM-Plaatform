import { type LeaveBalance, leaveRequestStatusValues } from '@hrm/contracts';
import {
  Alert,
  Button,
  EmptyState,
  LoadingBlock,
  Pagination,
  Select,
  Table,
  TableContainer,
  TabPanel,
  Tabs,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { CalendarDays, Plus, ScrollText } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../../components/page-header';
import { useErrorMessage } from '../../../lib/api/errors';
import { useCan } from '../../../lib/auth/me';
import { formatDate, todayIso } from '../../../lib/format';
import { LEDGER_TYPE_LABEL, leaveQueries } from '../api';
import { AdjustBalanceDialog } from '../components/adjust-balance-dialog';
import type { PickedEmployee } from '../components/employee-picker';
import { RequestsTable } from '../components/requests-table';
import { formatQty, isNegativeQty } from '../format';
import { manageBalanceParams, manageRequestParams } from '../search';

const route = getRouteApi('/_app/leave/manage');
type Search = ReturnType<typeof route.useSearch>;
export type ManageTab = 'requests' | 'balances' | 'ledger';

// SCREEN-INVENTORY 4.5: Requests, Balances and Ledger tabs; Adjust balance is the Balances tab's primary.
export function LeaveManagePage() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/leave/manage' });
  const canAdjust = useCan('leave.balance.adjust');
  const canOnBehalf = useCan('leave.request.review.all');
  const [adjusting, setAdjusting] = useState<{ employee: PickedEmployee | null; leaveTypeId: string } | null>(
    null,
  );
  const setSearch = (patch: Partial<Search>) => void navigate({ search: { ...search, page: 1, ...patch } });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Leave management"
        description="All leave requests, balances and ledger entries for the company."
        actions={
          <>
            {canOnBehalf ? (
              <Button variant={search.tab === 'balances' && canAdjust ? 'secondary' : 'primary'} asChild>
                <Link to="/leave/new">
                  <Plus aria-hidden="true" />
                  Request on behalf
                </Link>
              </Button>
            ) : null}
            {canAdjust && search.tab === 'balances' ? (
              <Button
                variant="primary"
                onClick={() => setAdjusting({ employee: null, leaveTypeId: search.leaveTypeId ?? '' })}
              >
                Adjust balance
              </Button>
            ) : null}
          </>
        }
      />
      <Tabs
        value={search.tab}
        onValueChange={(tab) => setSearch({ tab: tab as ManageTab })}
        tabs={[
          { value: 'requests', label: 'Requests' },
          { value: 'balances', label: 'Balances' },
          { value: 'ledger', label: 'Ledger' },
        ]}
      >
        <TabPanel value="requests">
          {search.tab === 'requests' ? <RequestsTab setSearch={setSearch} /> : null}
        </TabPanel>
        <TabPanel value="balances">
          {search.tab === 'balances' ? (
            <BalancesTab
              setSearch={setSearch}
              onAdjust={
                canAdjust
                  ? (b) =>
                      setAdjusting({
                        employee: { id: b.employeeId, name: b.employeeName, code: b.employeeCode },
                        leaveTypeId: b.leaveTypeId,
                      })
                  : null
              }
            />
          ) : null}
        </TabPanel>
        <TabPanel value="ledger">
          {search.tab === 'ledger' ? <LedgerTab setSearch={setSearch} /> : null}
        </TabPanel>
      </Tabs>
      {adjusting ? (
        <AdjustBalanceDialog initial={adjusting} year={search.year} onClose={() => setAdjusting(null)} />
      ) : null}
    </div>
  );
}

type SetSearch = (patch: Partial<Search>) => void;

function Filters({ setSearch, status = false }: { setSearch: SetSearch; status?: boolean }) {
  const { t } = useTranslation();
  const search = route.useSearch();
  const types = useQuery(leaveQueries.types(true));
  const year = Number(todayIso().slice(0, 4));
  return (
    <>
      {status ? (
        <Select
          aria-label="Status"
          className="w-52"
          value={search.status ?? ''}
          onChange={(e) => setSearch({ status: (e.target.value || undefined) as Search['status'] })}
        >
          <option value="">All statuses</option>
          {leaveRequestStatusValues
            .filter((s) => s !== 'draft')
            .map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
        </Select>
      ) : null}
      <Select
        aria-label="Leave type"
        className="w-48"
        value={search.leaveTypeId ?? ''}
        onChange={(e) => setSearch({ leaveTypeId: e.target.value || undefined })}
      >
        <option value="">All leave types</option>
        {types.data?.map((ty) => (
          <option key={ty.id} value={ty.id}>
            {ty.name}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Year"
        className="w-28"
        value={search.year}
        onChange={(e) => setSearch({ year: Number(e.target.value) })}
      >
        {[year + 1, year, year - 1, year - 2].map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </Select>
      {search.employeeId ? (
        <Button variant="text" onClick={() => setSearch({ employeeId: undefined })}>
          Show all employees
        </Button>
      ) : null}
    </>
  );
}

function ListState({
  query,
  label,
  empty,
  children,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  label: string;
  empty: boolean;
  children: ReactNode;
}) {
  const errorMessage = useErrorMessage();
  if (query.isPending)
    return (
      <div className="p-4">
        <LoadingBlock label={`Loading ${label}`} />
      </div>
    );
  if (query.isError)
    return (
      <div className="p-4">
        <Alert
          tone="bad"
          title={`We couldn't load ${label}.`}
          action={
            <Button size="sm" onClick={() => void query.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(query.error)}
        </Alert>
      </div>
    );
  if (empty)
    return (
      <EmptyState
        icon={CalendarDays}
        variant="no-results"
        title="No results"
        description="Try fewer filters."
        className="border-0"
      />
    );
  return <>{children}</>;
}

function RequestsTab({ setSearch }: { setSearch: SetSearch }) {
  const search = route.useSearch();
  const q = useQuery(leaveQueries.requests(manageRequestParams(search)));
  return (
    <TableContainer toolbar={<Filters setSearch={setSearch} status />}>
      <ListState query={q} label="leave requests" empty={!q.data?.data.length}>
        {q.data ? (
          <>
            <RequestsTable requests={q.data.data} showEmployee />
            <div className="border-t border-line px-4 py-2">
              <Pagination
                page={q.data.page.number}
                pageSize={q.data.page.size}
                totalItems={q.data.page.totalItems}
                onPage={(page) => setSearch({ page })}
                onPageSize={(pageSize) => setSearch({ pageSize })}
              />
            </div>
          </>
        ) : null}
      </ListState>
    </TableContainer>
  );
}

function BalancesTab({
  setSearch,
  onAdjust,
}: {
  setSearch: SetSearch;
  onAdjust: ((b: LeaveBalance) => void) | null;
}) {
  const search = route.useSearch();
  const q = useQuery(leaveQueries.balances(manageBalanceParams(search)));
  return (
    <TableContainer toolbar={<Filters setSearch={setSearch} />}>
      <ListState query={q} label="balances" empty={!q.data?.data.length}>
        {q.data ? (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Employee</TH>
                  <TH>Type</TH>
                  <TH numeric>Entitled</TH>
                  <TH numeric>Adjusted</TH>
                  <TH numeric>Used</TH>
                  <TH numeric>Reserved</TH>
                  <TH numeric>Available</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {q.data.data.map((b) => (
                  <TR key={`${b.employeeId}-${b.leaveTypeId}`}>
                    <TD className="whitespace-nowrap">
                      {b.employeeName} <span className="font-mono text-sm text-text-2">{b.employeeCode}</span>
                    </TD>
                    <TD className="whitespace-nowrap">{b.leaveTypeName}</TD>
                    <TD numeric>{formatQty(b.entitled)}</TD>
                    <TD numeric>{formatQty(b.adjusted)}</TD>
                    <TD numeric>{formatQty(b.used)}</TD>
                    <TD numeric>{formatQty(b.reserved)}</TD>
                    <TD numeric className={isNegativeQty(b.available) ? 'text-bad' : 'font-semibold'}>
                      {formatQty(b.available)}
                    </TD>
                    <TD className="text-right whitespace-nowrap">
                      <Button
                        variant="text"
                        onClick={() =>
                          setSearch({ tab: 'ledger', employeeId: b.employeeId, leaveTypeId: b.leaveTypeId })
                        }
                      >
                        Ledger
                        <span className="sr-only">
                          {' '}
                          for {b.employeeName}, {b.leaveTypeName}
                        </span>
                      </Button>
                      {onAdjust ? (
                        <Button variant="text" className="ml-4" onClick={() => onAdjust(b)}>
                          Adjust
                          <span className="sr-only">
                            {' '}
                            {b.employeeName}, {b.leaveTypeName}
                          </span>
                        </Button>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="border-t border-line px-4 py-2">
              <Pagination
                page={q.data.page.number}
                pageSize={q.data.page.size}
                totalItems={q.data.page.totalItems}
                onPage={(page) => setSearch({ page })}
                onPageSize={(pageSize) => setSearch({ pageSize })}
              />
            </div>
          </>
        ) : null}
      </ListState>
    </TableContainer>
  );
}

function LedgerTab({ setSearch }: { setSearch: SetSearch }) {
  const search = route.useSearch();
  const employeeId = search.employeeId;
  const q = useQuery({
    ...leaveQueries.ledger(employeeId ?? '', {
      year: search.year,
      page: search.page,
      pageSize: search.pageSize,
      ...(search.leaveTypeId ? { leaveTypeId: search.leaveTypeId } : {}),
    }),
    enabled: Boolean(employeeId),
  });
  // The ledger rows carry no name; one balance row of the same employee names the person.
  const who = useQuery({
    ...leaveQueries.balances({ year: search.year, employeeId, page: 1, pageSize: 1 }),
    enabled: Boolean(employeeId),
  });
  const person = who.data?.data[0];
  if (!employeeId)
    return (
      <EmptyState
        icon={ScrollText}
        variant="no-results"
        title="Choose an employee"
        description="Open the ledger from a row in the Balances tab."
        action={
          <Button variant="secondary" onClick={() => setSearch({ tab: 'balances' })}>
            Go to balances
          </Button>
        }
      />
    );
  return (
    <TableContainer
      toolbar={
        <>
          {person ? (
            <p className="mr-2 font-semibold">
              {person.employeeName}{' '}
              <span className="font-mono text-sm font-normal text-text-2">{person.employeeCode}</span>
            </p>
          ) : null}
          <Filters setSearch={setSearch} />
        </>
      }
    >
      <ListState query={q} label="ledger entries" empty={!q.data?.data.length}>
        {q.data ? (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Effective</TH>
                  <TH>Type</TH>
                  <TH>Entry</TH>
                  <TH numeric>Days</TH>
                  <TH>Reference</TH>
                  <TH>Reason</TH>
                </tr>
              </THead>
              <TBody>
                {q.data.data.map((e) => (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap">
                      <time dateTime={e.effectiveDate}>{formatDate(e.effectiveDate)}</time>
                    </TD>
                    <TD className="font-mono">{e.leaveTypeCode}</TD>
                    <TD className="whitespace-nowrap">{LEDGER_TYPE_LABEL[e.type]}</TD>
                    <TD numeric className={isNegativeQty(e.amount) ? 'text-bad' : undefined}>
                      {isNegativeQty(e.amount) ? '' : '+'}
                      {formatQty(e.amount)}
                    </TD>
                    <TD className="whitespace-nowrap">
                      {e.leaveRequestId && e.requestNumber ? (
                        <Link
                          to="/leave/requests/$requestId"
                          params={{ requestId: e.leaveRequestId }}
                          className="font-mono text-link underline-offset-4 hover:underline"
                        >
                          {e.requestNumber}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD className="min-w-48 text-text-2">{e.reason ?? '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="border-t border-line px-4 py-2">
              <Pagination
                page={q.data.page.number}
                pageSize={q.data.page.size}
                totalItems={q.data.page.totalItems}
                onPage={(page) => setSearch({ page })}
                onPageSize={(pageSize) => setSearch({ pageSize })}
              />
            </div>
          </>
        ) : null}
      </ListState>
    </TableContainer>
  );
}
