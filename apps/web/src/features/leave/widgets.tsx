import type { CurrentUser, LeaveRequestDto } from '@hrm/contracts';
import { Button, Card, CardHeader, StatBar, StatusBadge } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api/client';
import { todayIso } from '../../lib/format';
import { leaveQueries, type Page } from './api';
import { formatLeaveDates, formatQty } from './format';

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Widget 3 (INFORMATION-ARCHITECTURE §5): available days per type; StatBar holds up to four cells. */
export function LeaveBalancesWidget(_: { me: CurrentUser; primary: boolean }) {
  const balances = useQuery(leaveQueries.myBalances());
  const rows = balances.data?.data ?? [];
  return (
    <Card aria-labelledby="w-leave-balances">
      <CardHeader
        id="w-leave-balances"
        label={`Leave ${balances.data?.year ?? ''}`.trim()}
        title="My leave balances"
        actions={
          <Button variant="secondary" size="sm" asChild>
            <Link to="/leave/new">Request leave</Link>
          </Button>
        }
      />
      {balances.isPending ? (
        <p className="text-text-2">Loading balances…</p>
      ) : rows.length ? (
        <StatBar
          stats={rows
            .slice(0, 4)
            .map((b) => ({ label: `${b.leaveTypeName} available`, value: formatQty(b.available) }))}
        />
      ) : (
        <p className="text-text-2">No leave balances yet.</p>
      )}
    </Card>
  );
}

/** Widget 4, leave part: the last five open leave requests. */
export function MyLeaveRequestsWidget({ me }: { me: CurrentUser; primary: boolean }) {
  const { t } = useTranslation();
  const employeeId = me.employee?.id;
  const open = useQuery({
    queryKey: ['leave', 'requests', 'widget', employeeId],
    queryFn: () =>
      api.get<Page<LeaveRequestDto>>('/leave/requests', {
        query: { employeeId, status: 'pending,cancellation_pending', pageSize: 5, sort: '-startDate' },
      }),
    enabled: Boolean(employeeId),
  });
  return (
    <Card aria-labelledby="w-my-requests">
      <CardHeader
        id="w-my-requests"
        label="Leave"
        title="My requests"
        actions={
          <Button variant="text" asChild>
            <Link to="/leave">View all</Link>
          </Button>
        }
      />
      {open.data?.data.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {open.data.data.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <Link
                  to="/leave/requests/$requestId"
                  params={{ requestId: r.id }}
                  className="truncate text-link underline-offset-4 hover:underline"
                >
                  {r.leaveTypeName}
                </Link>
                <p className="text-sm text-text-2">
                  {formatLeaveDates(r)} · <span className="font-mono">{r.requestNumber}</span>
                </p>
              </div>
              <StatusBadge status={r.status} label={t(`status.${r.status}`)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-text-2">{open.isPending ? 'Loading requests…' : 'No open leave requests.'}</p>
      )}
    </Card>
  );
}

/** Widget 8: who is on leave in the next 7 days, from the leave calendar (scope as the API returns it). */
export function WhoIsOnLeaveWidget(_: { me: CurrentUser; primary: boolean }) {
  const today = todayIso();
  const cal = useQuery(leaveQueries.calendar(today, addDays(today, 6)));
  const entries = cal.data?.data ?? [];
  return (
    <Card aria-labelledby="w-on-leave">
      <CardHeader
        id="w-on-leave"
        label="Next 7 days"
        title="Who is on leave"
        actions={
          <Button variant="text" asChild>
            <Link to="/leave/calendar">Leave calendar</Link>
          </Button>
        }
      />
      {entries.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {entries.map((e) => (
            <li
              key={`${e.employeeId}-${e.startDate}-${e.halfDayPart ?? ''}`}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <span className="min-w-0 truncate">{e.employeeName}</span>
              <span className="shrink-0 text-sm text-text-2">
                {formatLeaveDates(e)}
                {e.status !== 'approved' ? ' · Pending' : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-text-2">{cal.isPending ? 'Loading…' : 'Nobody is on leave in the next 7 days.'}</p>
      )}
    </Card>
  );
}
