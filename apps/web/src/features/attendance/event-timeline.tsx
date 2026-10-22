import type { AttendanceEvent } from '@hrm/contracts';
import { Badge, cn } from '@hrm/ui';
import { formatDateTime, formatTime } from '../../lib/format';
import { EVENT_LABEL, SOURCE_LABEL } from './labels';

function times(e: AttendanceEvent) {
  if (e.type === 'check_in' || e.type === 'check_out') return formatTime(e.occurredAt);
  const parts = [
    e.checkInAt ? `in ${formatTime(e.checkInAt)}` : null,
    e.checkOutAt ? `out ${formatTime(e.checkOutAt)}` : null,
  ].filter(Boolean);
  return parts.join(', ');
}

/**
 * A day's events, newest first (COMPONENT-SPECS §16). Originals stay next to the corrections that override them
 * (FR-ATT-008); there are no edit or delete affordances.
 */
export function EventTimeline({ events }: { events: AttendanceEvent[] }) {
  if (!events.length) return <p className="text-text-2">No check-ins recorded for this day.</p>;
  const ordered = [...events].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  return (
    <ol className="relative flex flex-col gap-5 before:absolute before:top-2 before:bottom-2 before:left-[3px] before:w-px before:bg-line">
      {ordered.map((e, i) => (
        <li key={e.id} className="relative flex flex-col gap-1 pl-6">
          <span
            className={cn(
              'absolute top-1.5 left-0 size-2 rounded-full',
              i === 0 ? 'bg-accent' : 'bg-line-strong',
            )}
            aria-hidden="true"
          />
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{EVENT_LABEL[e.type]}</span>
            <span className="font-mono tabular-nums">{times(e)}</span>
            {e.type === 'correction' || e.type === 'manual_entry' ? (
              <Badge tone="info">{SOURCE_LABEL[e.source]}</Badge>
            ) : (
              <Badge>Original</Badge>
            )}
          </p>
          <p className="text-sm text-text-2">
            {e.recordedByName ? `${e.recordedByName} · ` : ''}
            Recorded <time dateTime={e.recordedAt}>{formatDateTime(e.recordedAt)}</time>
          </p>
          {e.reason ? (
            <blockquote className="mt-1 rounded-control bg-ground-2 px-3 py-2 text-[15px]">
              {e.reason}
            </blockquote>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
