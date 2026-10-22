import type { AttendanceRecord, AttendanceStatus } from '@hrm/contracts';
import { Button, Card, cn, StatusBadge, type Tone, toneFor } from '@hrm/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatMonth, formatTime } from '../../lib/format';
import { daysInMonth, monthOf, shiftMonth, weekday } from './dates';
import { formatWeekdayDate } from './labels';

const CELL: Record<Tone, string> = {
  neutral: 'border-line bg-transparent',
  warn: 'border-transparent bg-warn-tint',
  ok: 'border-transparent bg-ok-tint',
  bad: 'border-transparent bg-bad-tint',
  info: 'border-transparent bg-accent-tint',
  locked: 'border-line bg-ground-2',
};
const LABEL: Record<Tone, string> = {
  neutral: 'text-text-2',
  warn: 'text-warn',
  ok: 'text-ok',
  bad: 'text-bad',
  info: 'text-accent-text',
  locked: 'text-text',
};
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LEGEND: AttendanceStatus[] = [
  'present',
  'short_hours',
  'missed_core',
  'missing_punch',
  'on_leave',
  'absent',
];

/**
 * My month (SCREEN-INVENTORY §3.1): a calendar with a status per day on wider screens, a vertical day list on phones.
 * Selecting a past day offers a correction; the server's status is shown as is (USER-FLOWS §3 step 5).
 */
export function MonthView({
  month,
  today,
  records,
  selected,
  onSelect,
  onMonth,
}: {
  month: string;
  today: string;
  records: AttendanceRecord[];
  selected: string | undefined;
  onSelect: (date: string) => void;
  onMonth: (month: string) => void;
}) {
  const { t } = useTranslation();
  const byDate = new Map(records.map((r) => [r.workDate, r]));
  const [y = 1970, m = 1] = month.split('-').map(Number);
  const label = formatMonth(y, m);
  const dates = Array.from(
    { length: daysInMonth(month) },
    (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`,
  );
  const past = dates.filter((d) => d <= today);
  const isCurrent = month >= monthOf(today);

  const cellLabel = (d: string) => {
    const r = byDate.get(d);
    if (r) return t(`status.${r.status}`);
    return d < today ? 'No record' : d === today ? 'Today' : '';
  };

  return (
    <Card aria-labelledby="month-title" className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="icon"
          size="icon"
          aria-label="Previous month"
          onClick={() => onMonth(shiftMonth(month, -1))}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <h2 id="month-title" className="font-display text-[17px] font-semibold" aria-live="polite">
          {label}
        </h2>
        <Button
          variant="icon"
          size="icon"
          aria-label="Next month"
          disabled={isCurrent}
          onClick={() => onMonth(shiftMonth(month, 1))}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>

      <div className="hidden grid-cols-7 gap-1.5 sm:grid">
        {WEEK.map((w) => (
          <span
            key={w}
            className="pb-1 text-center font-mono text-[11px] uppercase text-text-3"
            aria-hidden="true"
          >
            {w}
          </span>
        ))}
        {Array.from({ length: weekday(dates[0] ?? `${month}-01`) }, (_, i) => (
          <span key={`pad-${i}`} aria-hidden="true" />
        ))}
        {dates.map((d) => {
          const r = byDate.get(d);
          const tone = r ? toneFor(r.status) : 'neutral';
          const text = cellLabel(d);
          // The visible day number is part of the accessible name; the weekday and month are added for screen readers.
          const body = (
            <>
              <span className="font-mono text-[13px] text-text-2">
                <span className="sr-only">{formatWeekdayDate(d).split(' ')[0]} </span>
                {Number(d.slice(8))}
                <span className="sr-only">{` ${label.split(' ')[0]}: `}</span>
              </span>
              <span className={cn('truncate text-[11px] font-semibold', LABEL[tone])}>{text}</span>
            </>
          );
          const cls = cn(
            'flex h-16 min-w-0 flex-col justify-between rounded-control border p-2 text-left',
            CELL[tone],
            d === today && 'ring-1 ring-accent ring-inset',
          );
          if (d > today)
            return (
              <div key={d} className={cn(cls, 'border-dashed')} aria-hidden="true">
                {body}
              </div>
            );
          return (
            <button
              key={d}
              type="button"
              className={cn(
                cls,
                'cursor-pointer hover:border-text-2',
                selected === d && 'outline-2 outline-offset-1 outline-text',
              )}
              aria-pressed={selected === d}
              title={text}
              onClick={() => onSelect(d)}
            >
              {body}
            </button>
          );
        })}
      </div>

      <ul className="flex flex-col divide-y divide-line sm:hidden">
        {[...past].reverse().map((d) => {
          const r = byDate.get(d);
          return (
            <li key={d}>
              <button
                type="button"
                aria-pressed={selected === d}
                onClick={() => onSelect(d)}
                className={cn(
                  'flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 px-1 py-2 text-left',
                  selected === d && 'bg-ground-2',
                )}
              >
                <span className="flex flex-col">
                  <span className="font-medium">{formatWeekdayDate(d)}</span>
                  {r?.firstInAt || r?.lastOutAt ? (
                    <span className="font-mono text-sm text-text-2 tabular-nums">
                      {r.firstInAt ? formatTime(r.firstInAt) : '—'} to{' '}
                      {r.lastOutAt ? formatTime(r.lastOutAt) : '—'}
                    </span>
                  ) : null}
                </span>
                {r ? (
                  <StatusBadge status={r.status} label={t(`status.${r.status}`)} />
                ) : (
                  <span className="text-sm text-text-2">{cellLabel(d)}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <ul className="flex flex-wrap gap-2" aria-label="Status key">
        {LEGEND.map((s) => (
          <li key={s}>
            <StatusBadge status={s} label={t(`status.${s}`)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
