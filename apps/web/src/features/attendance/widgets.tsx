import type { CurrentUser } from '@hrm/contracts';
import { Alert, Button, Card, CardHeader, notify, StatBar } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import { can } from '../../lib/auth/me';
import { formatDuration, todayIso } from '../../lib/format';
import { attendanceQueries } from './api';
import { formatClock } from './labels';
import { stateText, useNow, usePunchAction, workedSoFar } from './today-panel';

/** Dashboard widget 2 "Today's attendance" (INFORMATION-ARCHITECTURE §5): the employee's primary action. */
export function TodayAttendanceWidget({ me, primary }: { me: CurrentUser; primary: boolean }) {
  const today = useQuery({ ...attendanceQueries.today(), enabled: Boolean(me.employee) });
  const now = useNow();
  const action = usePunchAction(today.data);
  const worked = today.data ? workedSoFar(today.data, now) : null;
  const schedule = today.data?.schedule;
  return (
    <Card aria-labelledby="w-attendance" className="flex h-full flex-col gap-4">
      <CardHeader
        id="w-attendance"
        label="Today's attendance"
        title={today.data ? stateText(today.data) : me.employee ? 'Loading…' : 'No employee record'}
        actions={
          <Button variant="text" asChild>
            <Link to="/attendance">My attendance</Link>
          </Button>
        }
      />
      {today.data ? (
        <>
          <p className="text-text-2">
            {worked !== null ? (
              <>
                Worked <span className="font-mono text-text tabular-nums">{formatDuration(worked)}</span>
                {schedule ? ' · ' : ''}
              </>
            ) : null}
            {schedule
              ? schedule.isWorkingDay
                ? `Core hours ${formatClock(schedule.coreStart)} to ${formatClock(schedule.coreEnd)}`
                : 'Today is a non-working day in your schedule.'
              : null}
          </p>
          {can(me, 'attendance.check_in.own') ? (
            <Button
              variant={primary ? 'primary' : 'secondary'}
              size="lg"
              className="w-full sm:w-fit"
              icon={action.icon}
              loading={action.pending}
              onClick={() => void action.run()}
            >
              {action.label}
            </Button>
          ) : null}
          {action.error ? (
            <Alert tone="bad" assertive>
              {action.error}
            </Alert>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

/** Dashboard widget 7 "Team today": counts per status for the reports in scope (INFORMATION-ARCHITECTURE §5). */
export function TeamTodayWidget(_: { me: CurrentUser; primary: boolean }) {
  const today = todayIso();
  const summary = useQuery(attendanceQueries.summary({ from: today, to: today }));
  const total = (key: 'present' | 'on_leave' | 'absent' | 'missing_punch') =>
    summary.data ? summary.data.data.reduce((n, r) => n + r.counts[key], 0) : '—';
  return (
    <Card aria-labelledby="w-team-today" className="flex h-full flex-col gap-4">
      <CardHeader
        id="w-team-today"
        label="Team today"
        title="Your team's attendance"
        actions={
          <Button variant="text" asChild>
            <Link to="/attendance/team" search={{ from: today, to: today }}>
              Team attendance
            </Link>
          </Button>
        }
      />
      <StatBar
        stats={[
          { label: 'Present', value: total('present') },
          { label: 'On leave', value: total('on_leave') },
          { label: 'Absent', value: total('absent') },
          { label: 'Missing punch', value: total('missing_punch') },
        ]}
      />
      <p className="text-sm text-text-2">
        Someone still checked in counts as missing punch until they check out. Absent is set after midnight.
      </p>
    </Card>
  );
}

/** Top-bar check-in shortcut (INFORMATION-ARCHITECTURE §4.1 item 5): desktop only; phones use the Attendance tab. */
export function CheckInShortcut({ me }: { me: CurrentUser }) {
  const today = useQuery({ ...attendanceQueries.today(), enabled: Boolean(me.employee) });
  const now = useNow();
  const action = usePunchAction(today.data);
  useEffect(() => {
    if (action.error) notify.error(action.error);
  }, [action.error]);
  if (!today.data) return null;
  const worked = workedSoFar(today.data, now);
  return (
    <div className="hidden items-center gap-3 lg:flex">
      {worked !== null && (worked > 0 || action.checkedIn) ? (
        <span className="font-mono text-sm text-text-2 tabular-nums">
          <span className="sr-only">Worked today </span>
          {formatDuration(worked)}
        </span>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        icon={action.icon}
        loading={action.pending}
        onClick={() => void action.run()}
      >
        {action.checkedIn ? 'Check out' : 'Check in'}
      </Button>
    </div>
  );
}
