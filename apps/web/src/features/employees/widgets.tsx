import type { EmployeeStatus } from '@hrm/contracts';
import { Button, Card, CardHeader, Skeleton, StatBar } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useErrorMessage } from '../../lib/api/errors';
import { formatDate } from '../../lib/format';
import { employeeQueries } from './api';

const SHOWN: EmployeeStatus[] = ['active', 'probation', 'notice_period', 'preboarding'];

/**
 * Dashboard widget 9 "People overview" (INFORMATION-ARCHITECTURE §5, `report.hr`): headcount by status from
 * `GET /reports/headcount`. Joiners, leavers and probation endings need report filters the API does not have yet.
 */
export function PeopleOverviewWidget() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const headcount = useQuery(employeeQueries.headcountByStatus());
  const count = (s: EmployeeStatus) =>
    headcount.data?.data.reduce((n, r) => n + (r.byStatus[s] ?? 0), 0) ?? 0;
  return (
    <Card aria-labelledby="w-people">
      <CardHeader
        id="w-people"
        label="People overview"
        title={headcount.data ? `${headcount.data.summary.total} employees` : 'Headcount'}
        actions={
          <Button variant="text" size="sm" asChild>
            <a href="/reports/headcount">Headcount report</a>
          </Button>
        }
      />
      {headcount.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : headcount.isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-text-2">{errorMessage(headcount.error)}</p>
          <Button variant="secondary" size="sm" onClick={() => void headcount.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <StatBar stats={SHOWN.map((s) => ({ label: t(`status.${s}`), value: count(s) }))} />
          <p className="text-sm text-text-2">As of {formatDate(headcount.data.summary.asOf)}</p>
        </div>
      )}
    </Card>
  );
}
