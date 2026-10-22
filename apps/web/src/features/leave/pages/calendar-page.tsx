import type { Holiday, LeaveCalendarEntry } from '@hrm/contracts';
import { Alert, Button, cn, EmptyState, LoadingBlock } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { PageHeader } from '../../../components/page-header';
import { useErrorMessage } from '../../../lib/api/errors';
import { useCan } from '../../../lib/auth/me';
import { formatDate, formatMonth, todayIso } from '../../../lib/format';
import { orgQueries } from '../../organization/api';
import { leaveQueries } from '../api';
import { byPerson, covers, monthBounds, monthDays, segments, shiftMonth, weekday } from '../calendar';
import { formatLeaveDates, halfDayLabel } from '../format';

const route = getRouteApi('/_app/leave/calendar');
const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const isPending = (e: LeaveCalendarEntry) => e.status !== 'approved';

function describe(e: LeaveCalendarEntry) {
  const parts = [e.employeeName, e.leaveType?.name ?? 'Leave', formatLeaveDates(e)];
  if (e.status === 'pending') parts.push('Pending');
  if (e.status === 'cancellation_pending') parts.push('Cancellation pending');
  return parts.join(', ');
}

// SCREEN-INVENTORY 4.4: month grid on desktop, agenda by day on mobile. Shows exactly what the API returns: types only
// for leave readers and one's own entries, colleagues' approved leave only when the company setting allows it.
export function LeaveCalendarPage() {
  const { month } = route.useSearch();
  const navigate = useNavigate({ from: '/leave/calendar' });
  const errorMessage = useErrorMessage();
  const isReader = useCan('leave.read.all', 'leave.read.team');
  const { from, to } = monthBounds(month);
  const cal = useQuery(leaveQueries.calendar(from, to));
  const holidays = useQuery(orgQueries.holidays(Number(month.slice(0, 4))));
  const days = monthDays(month);
  const holidayOn = new Map<string, Holiday>(
    (holidays.data ?? []).filter((h) => h.date >= from && h.date <= to).map((h) => [h.date, h]),
  );
  const [y, m] = month.split('-').map(Number) as [number, number];
  const go = (delta: number) => void navigate({ search: { month: shiftMonth(month, delta) } });
  const thisMonth = todayIso().slice(0, 7);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Leave calendar"
        description={
          isReader
            ? 'Approved and pending leave for the people you can see.'
            : 'Your own leave and holidays. Colleagues appear only if your company shares team leave.'
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="icon" size="icon-sm" aria-label="Previous month" onClick={() => go(-1)}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <h2 className="min-w-40 text-center font-display text-xl font-semibold" aria-live="polite">
          {formatMonth(y, m)}
        </h2>
        <Button variant="icon" size="icon-sm" aria-label="Next month" onClick={() => go(1)}>
          <ChevronRight aria-hidden="true" />
        </Button>
        {month !== thisMonth ? (
          <Button
            variant="text"
            className="ml-2"
            onClick={() => void navigate({ search: { month: thisMonth } })}
          >
            This month
          </Button>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-4 text-sm text-text-2">
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-6 rounded-sm bg-accent-tint" aria-hidden="true" /> Approved
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-6 rounded-sm border border-dashed border-warn" aria-hidden="true" />{' '}
            Pending
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-6 rounded-sm bg-line" aria-hidden="true" /> Holiday
          </span>
        </div>
      </div>
      {cal.isPending ? (
        <LoadingBlock label="Loading leave calendar" />
      ) : cal.isError ? (
        <Alert
          tone="bad"
          title="We couldn't load the leave calendar."
          action={
            <Button size="sm" onClick={() => void cal.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(cal.error)}
        </Alert>
      ) : !cal.data.data.length && !holidayOn.size ? (
        <EmptyState
          icon={CalendarRange}
          variant="no-results"
          title={`Nobody is on leave in ${formatMonth(y, m)}`}
          description="Approved and pending leave appears here."
        />
      ) : (
        <>
          <MonthGrid days={days} entries={cal.data.data} holidayOn={holidayOn} />
          <Agenda days={days} entries={cal.data.data} holidayOn={holidayOn} />
        </>
      )}
    </div>
  );
}

function MonthGrid({
  days,
  entries,
  holidayOn,
}: {
  days: string[];
  entries: LeaveCalendarEntry[];
  holidayOn: Map<string, Holiday>;
}) {
  const rows = byPerson(entries);
  const today = todayIso();
  return (
    <div className="hidden overflow-hidden rounded-card border border-line bg-surface md:block">
      <div className="overflow-x-auto">
        {/* Fixed layout: every day column is 2rem wide however long a bar's label is. */}
        <table
          className="w-full table-fixed border-collapse text-sm"
          style={{ minWidth: `${9 + days.length * 2}rem` }}
        >
          <colgroup>
            <col className="w-36" />
            {days.map((d) => (
              <col key={d} className="w-8" />
            ))}
          </colgroup>
          <caption className="sr-only">Leave by person and day</caption>
          <thead className="bg-ground-2">
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-ground-2 px-3 text-left font-mono text-[11px] font-medium uppercase tracking-[0.13em] text-text-3"
              >
                Person
              </th>
              {days.map((d) => {
                const h = holidayOn.get(d);
                return (
                  <th
                    key={d}
                    scope="col"
                    title={h ? `${formatDate(d)}: ${h.name}` : formatDate(d)}
                    className={cn(
                      'h-12 px-0 text-center font-mono text-[11px] font-medium text-text-3',
                      h && 'bg-line text-text',
                      d === today && 'text-accent-text',
                    )}
                  >
                    <span aria-hidden="true" className="flex flex-col leading-tight">
                      <span>{WEEKDAY[weekday(d)]}</span>
                      <span className="text-[13px]">{Number(d.slice(8))}</span>
                    </span>
                    <span className="sr-only">
                      {WEEKDAY_LONG[weekday(d)]} {formatDate(d)}
                      {h ? `, holiday: ${h.name}` : ''}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.employeeId} className="border-t border-line">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 h-11 truncate bg-surface px-3 text-left font-normal"
                  >
                    {row.employeeName}
                  </th>
                  {segments(days, row.entries).flatMap((s) =>
                    s.kind === 'leave'
                      ? [
                          <td key={s.start} colSpan={s.span} className="px-0.5 py-1.5">
                            <LeaveBar entry={s.entry} />
                          </td>,
                        ]
                      : days.slice(days.indexOf(s.start), days.indexOf(s.start) + s.span).map((d) => (
                          <td key={d} className={cn('h-11', holidayOn.has(d) && 'bg-line')}>
                            <span className="sr-only">—</span>
                          </td>
                        )),
                  )}
                </tr>
              ))
            ) : (
              <tr className="border-t border-line">
                <td colSpan={days.length + 1} className="h-11 px-3 text-text-2">
                  Nobody is on leave this month.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeaveBar({ entry: e }: { entry: LeaveCalendarEntry }) {
  const label = `${e.leaveType?.code ?? 'Leave'}${e.unit === 'half_day' ? ' ½' : ''}${isPending(e) ? ' · Pending' : ''}`;
  const className = cn(
    'flex h-8 items-center overflow-hidden rounded-control px-1.5 text-xs font-medium whitespace-nowrap',
    isPending(e) ? 'border border-dashed border-warn text-text' : 'bg-accent-tint text-text',
  );
  const content = (
    <>
      <span aria-hidden="true" className="truncate">
        {label}
      </span>
      <span className="sr-only">{describe(e)}</span>
    </>
  );
  return e.requestId ? (
    <Link
      to="/leave/requests/$requestId"
      params={{ requestId: e.requestId }}
      title={describe(e)}
      className={cn(className, 'hover:underline')}
    >
      {content}
    </Link>
  ) : (
    <span title={describe(e)} className={className}>
      {content}
    </span>
  );
}

/** Mobile: the days that have leave or a holiday, in order (SCREEN-INVENTORY 4.4). */
function Agenda({
  days,
  entries,
  holidayOn,
}: {
  days: string[];
  entries: LeaveCalendarEntry[];
  holidayOn: Map<string, Holiday>;
}) {
  const withContent = days
    .map((d) => ({ d, on: entries.filter((e) => covers(e, d)), holiday: holidayOn.get(d) }))
    .filter((x) => x.on.length || x.holiday);
  if (!withContent.length) return <p className="text-text-2 md:hidden">Nobody is on leave this month.</p>;
  return (
    <ol className="flex flex-col gap-3 md:hidden">
      {withContent.map(({ d, on, holiday }) => (
        <li key={d} className="rounded-card border border-line bg-surface p-4">
          <h3 className="flex flex-wrap items-baseline justify-between gap-2 font-semibold">
            <span>
              {WEEKDAY_LONG[weekday(d)]} {formatDate(d)}
            </span>
            {holiday ? (
              <span className="text-sm font-normal text-text-2">Holiday: {holiday.name}</span>
            ) : null}
          </h3>
          {on.length ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {on.map((e) => (
                <li
                  key={`${e.employeeId}-${e.startDate}-${e.halfDayPart ?? ''}`}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  {e.requestId ? (
                    <Link
                      to="/leave/requests/$requestId"
                      params={{ requestId: e.requestId }}
                      className="text-link underline-offset-4 hover:underline"
                    >
                      {e.employeeName}
                    </Link>
                  ) : (
                    <span>{e.employeeName}</span>
                  )}
                  <span className="text-sm text-text-2">
                    {e.leaveType?.name ?? 'Leave'}
                    {e.unit === 'half_day' && e.halfDayPart ? ` · ${halfDayLabel(e.halfDayPart)}` : ''}
                    {isPending(e) ? ' · Pending' : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
