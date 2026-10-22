import { claimStatusValues } from '@hrm/contracts';
import { Button, EmptyState, LoadingBlock, Pagination, Select, TableContainer } from '@hrm/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { Plus, Receipt } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { PageHeader } from '../../components/page-header';
import { useMe } from '../../lib/auth/me';
import { claimQueries } from './api';
import { ClaimsTable } from './ClaimsTable';

const route = getRouteApi('/_app/reimbursements/');

// SCREEN-INVENTORY 5.1: the caller's own claims, newest first.
export function MyClaimsPage() {
  const { t } = useTranslation();
  const me = useMe();
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/reimbursements/' });
  const employeeId = me?.employee?.id;
  const list = useQuery({
    ...claimQueries.list({ ...search, employeeId }),
    enabled: Boolean(employeeId),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My claims"
        description="Transport costs you claim are paid with your salary once approved."
        actions={
          <Button variant="primary" icon={<Plus aria-hidden="true" />} asChild>
            <Link to="/reimbursements/new">New claim</Link>
          </Button>
        }
      />
      <TableContainer
        toolbar={
          <Select
            aria-label="Status"
            className="w-48"
            value={search.status ?? ''}
            onChange={(e) =>
              void navigate({
                search: { ...search, page: 1, status: (e.target.value || undefined) as never },
              })
            }
          >
            <option value="">All statuses</option>
            {claimStatusValues.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        }
      >
        {!employeeId ? (
          <EmptyState
            icon={Receipt}
            variant="no-results"
            title="No employee record"
            description="Your sign-in isn't linked to an employee record, so you can't submit claims."
            className="border-0"
          />
        ) : list.isPending ? (
          <div className="p-4">
            <LoadingBlock label="Loading claims" />
          </div>
        ) : list.isError ? (
          <LoadError thing="your claims" error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.data.data.length ? (
          search.status ? (
            <EmptyState
              icon={Receipt}
              variant="no-results"
              title="No results"
              description="No claims have this status."
              action={
                <Button
                  variant="secondary"
                  onClick={() => void navigate({ search: { page: 1, pageSize: search.pageSize } })}
                >
                  Reset filters
                </Button>
              }
              className="border-0"
            />
          ) : (
            <EmptyState
              icon={Receipt}
              title="No claims yet"
              description="Submit transport costs here and they're paid with your salary."
              className="border-0"
            />
          )
        ) : (
          <div aria-busy={list.isFetching} className={list.isPlaceholderData ? 'opacity-60' : undefined}>
            <ClaimsTable claims={list.data.data} caption="My claims" />
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
