import { leaveRequestStatusValues } from '@hrm/contracts';
import { Alert, Button, EmptyState, LoadingBlock, Pagination, Select, TableContainer } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { CalendarDays, CalendarRange, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../../components/page-header';
import { useErrorMessage } from '../../../lib/api/errors';
import { useMe } from '../../../lib/auth/me';
import { todayIso } from '../../../lib/format';
import { leaveQueries } from '../api';
import { BalanceCards } from '../components/balance-cards';
import { RequestsTable } from '../components/requests-table';
import { yearRange } from '../format';

const route = getRouteApi('/_app/leave/');
export const thisLeaveYear = () => Number(todayIso().slice(0, 4));

export function myRequestParams(
  employeeId: string,
  s: {
    year: number;
    status?: (typeof leaveRequestStatusValues)[number] | undefined;
    page: number;
    pageSize: number;
  },
) {
  return { employeeId, status: s.status, page: s.page, pageSize: s.pageSize, ...yearRange(s.year) };
}

// SCREEN-INVENTORY 4.1, USER-FLOWS 5.1 step 1.
export function MyLeavePage() {
  const { t } = useTranslation();
  const me = useMe();
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/leave/' });
  const errorMessage = useErrorMessage();
  const employeeId = me?.employee?.id ?? '';
  const balances = useQuery(leaveQueries.myBalances(search.year));
  const requests = useQuery({
    ...leaveQueries.requests(myRequestParams(employeeId, search)),
    enabled: Boolean(employeeId),
  });
  const year = thisLeaveYear();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My leave"
        description={`Leave year 1 Jan to 31 Dec ${search.year}. Pending requests hold days until they're decided.`}
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link to="/leave/calendar">
                <CalendarRange aria-hidden="true" />
                Leave calendar
              </Link>
            </Button>
            <Button variant="primary" asChild>
              <Link to="/leave/new">
                <Plus aria-hidden="true" />
                Request leave
              </Link>
            </Button>
          </>
        }
      />
      <section aria-label="Balances">
        {balances.isPending ? (
          <LoadingBlock label="Loading balances" rows={2} />
        ) : balances.isError ? (
          <Alert tone="bad" title="We couldn't load your balances.">
            {errorMessage(balances.error)}
          </Alert>
        ) : balances.data.data.length ? (
          <BalanceCards balances={balances.data.data} />
        ) : (
          <p className="text-text-2">No leave balances for {search.year} yet.</p>
        )}
      </section>
      <section aria-labelledby="my-requests" className="flex flex-col gap-3">
        <h2 id="my-requests" className="font-display text-xl font-semibold">
          Requests
        </h2>
        <TableContainer
          toolbar={
            <>
              <Select
                aria-label="Status"
                className="w-52"
                value={search.status ?? ''}
                onChange={(e) =>
                  void navigate({
                    search: { ...search, page: 1, status: (e.target.value || undefined) as never },
                  })
                }
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
              <Select
                aria-label="Year"
                className="w-28"
                value={search.year}
                onChange={(e) =>
                  void navigate({ search: { ...search, page: 1, year: Number(e.target.value) } })
                }
              >
                {[year + 1, year, year - 1, year - 2].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            </>
          }
        >
          {requests.isPending ? (
            <div className="p-4">
              <LoadingBlock label="Loading requests" />
            </div>
          ) : requests.isError ? (
            <div className="p-4">
              <Alert
                tone="bad"
                title="We couldn't load your requests."
                action={
                  <Button size="sm" onClick={() => void requests.refetch()}>
                    Try again
                  </Button>
                }
              >
                {errorMessage(requests.error)}
              </Alert>
            </div>
          ) : !requests.data.data.length ? (
            <EmptyState
              icon={CalendarDays}
              variant={search.status ? 'no-results' : 'first-use'}
              title={search.status ? 'No results' : 'No leave requests yet'}
              description={
                search.status ? 'Try fewer filters.' : 'Requests you submit appear here with their status.'
              }
              className="border-0"
            />
          ) : (
            <>
              <RequestsTable requests={requests.data.data} />
              <div className="border-t border-line px-4 py-2">
                <Pagination
                  page={requests.data.page.number}
                  pageSize={requests.data.page.size}
                  totalItems={requests.data.page.totalItems}
                  onPage={(page) => void navigate({ search: { ...search, page } })}
                  onPageSize={(pageSize) => void navigate({ search: { ...search, page: 1, pageSize } })}
                />
              </div>
            </>
          )}
        </TableContainer>
      </section>
    </div>
  );
}
