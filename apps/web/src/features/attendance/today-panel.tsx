import type { AttendanceToday } from '@hrm/contracts';
import { Alert, Badge, Button, Card, notify, StatusBadge } from '@hrm/ui';
import { LogIn, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useErrorMessage } from '../../lib/api/errors';
import { formatDuration, formatTime } from '../../lib/format';
import { useCheckIn, useCheckOut } from './api';
import { formatWeekdayDate } from './labels';

/** The current time, refreshed every `ms` (the worked-time counter is display only, USER-FLOWS §3). */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** Worked minutes so far: the server's completed pairs plus the open pair's elapsed time. */
export function workedSoFar(today: AttendanceToday, now: number): number | null {
  const base = today.record?.workedMinutes ?? 0;
  if (today.state === 'checked_in' && today.openCheckInAt) {
    return base + Math.max(0, Math.floor((now - Date.parse(today.openCheckInAt)) / 60_000));
  }
  return today.record ? base : null;
}

export function stateText(today: AttendanceToday) {
  if (today.state === 'checked_in' && today.openCheckInAt)
    return `Checked in at ${formatTime(today.openCheckInAt)}`;
  if (today.state === 'checked_out' && today.record?.lastOutAt)
    return `Checked out at ${formatTime(today.record.lastOutAt)}`;
  return 'Not checked in';
}

/** Check in or check out, whichever is next, with the error mapped by code (USER-FLOWS §3 failures). */
export function usePunchAction(today: AttendanceToday | undefined) {
  const checkIn = useCheckIn();
  const checkOut = useCheckOut();
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<string | null>(null);
  const checkedIn = today?.state === 'checked_in';
  const run = async () => {
    setError(null);
    try {
      await (checkedIn ? checkOut : checkIn).mutateAsync();
      notify.success(checkedIn ? 'Checked out' : 'Checked in');
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return {
    checkedIn,
    label: checkedIn ? 'Check out' : today?.state === 'checked_out' ? 'Check in again' : 'Check in',
    icon: checkedIn ? <LogOut aria-hidden="true" /> : <LogIn aria-hidden="true" />,
    run,
    pending: checkIn.isPending || checkOut.isPending,
    error,
  };
}

function Figure({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] uppercase tracking-[0.13em] text-text-3">{label}</span>
      <span
        className={`font-mono text-2xl leading-tight tabular-nums ${value ? 'text-text' : 'text-text-3'}`}
      >
        {value ?? '—'}
      </span>
    </div>
  );
}

/**
 * Today's panel on `/attendance` (SCREEN-INVENTORY §3.1): state, times, worked time and the page's primary action.
 * After a check-out the action becomes secondary ("Check in again"), so the day is not reopened by accident.
 */
export function TodayPanel({ today, canPunch }: { today: AttendanceToday; canPunch: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const action = usePunchAction(today);
  const worked = workedSoFar(today, now);
  const firstIn = today.record?.firstInAt ?? today.openCheckInAt;
  const lastOut = today.state === 'checked_out' ? (today.record?.lastOutAt ?? null) : null;
  return (
    <Card aria-labelledby="today-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <div className="flex flex-col gap-1.5">
            <h2 id="today-title" className="font-mono text-[11px] uppercase tracking-[0.13em] text-text-3">
              Today · {formatWeekdayDate(today.workDate)}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={today.state === 'checked_in' ? 'ok' : 'neutral'}>
                {today.state === 'checked_in'
                  ? 'Checked in'
                  : today.state === 'checked_out'
                    ? 'Checked out'
                    : 'Not checked in'}
              </Badge>
              {today.record && today.state !== 'checked_in' ? (
                <StatusBadge status={today.record.status} label={t(`status.${today.record.status}`)} />
              ) : null}
            </div>
          </div>
          <Figure label="In" value={firstIn ? formatTime(firstIn) : null} />
          <Figure label="Out" value={lastOut ? formatTime(lastOut) : null} />
          <Figure
            label={today.state === 'checked_in' ? 'Worked so far' : 'Worked'}
            value={worked === null ? null : formatDuration(worked)}
          />
        </div>
        {canPunch ? (
          <Button
            variant={action.checkedIn || today.state === 'not_checked_in' ? 'primary' : 'secondary'}
            size="lg"
            className="w-full sm:w-auto sm:min-w-40"
            icon={action.icon}
            loading={action.pending}
            onClick={() => void action.run()}
          >
            {action.label}
          </Button>
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite">
        {stateText(today)}
      </p>
      {action.error ? (
        <Alert tone="bad" assertive>
          {action.error}
        </Alert>
      ) : null}
      {today.schedule && !today.schedule.isWorkingDay ? (
        <Alert tone="info">Today is a non-working day in your schedule.</Alert>
      ) : null}
      {today.record?.needsReview ? (
        <Alert tone="warn">This day has a check-out after midnight. HR may review it.</Alert>
      ) : null}
    </Card>
  );
}
