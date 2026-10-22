import type { AttendanceRecord } from '@hrm/contracts';
import { Badge, Button, Card, CardHeader, KeyValueList, StatusBadge } from '@hrm/ui';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { formatDuration, formatTime } from '../../lib/format';
import { formatWeekdayDate } from './labels';

export function RecordFlags({ record }: { record: AttendanceRecord }) {
  const flags = [
    record.hasManualEntry ? 'Manual entry' : null,
    record.hasCorrection ? 'Corrected' : null,
    record.needsReview ? 'After midnight' : null,
  ].filter((f): f is string => f !== null);
  if (!flags.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {flags.map((f) => (
        <Badge key={f} tone={f === 'After midnight' ? 'warn' : 'info'}>
          {f}
        </Badge>
      ))}
    </span>
  );
}

/** The day chosen in the calendar, with the way to correct it (USER-FLOWS §4 step 1). */
export function SelectedDay({
  date,
  record,
  employeeId,
  canRequest,
  onRequest,
}: {
  date: string;
  record: AttendanceRecord | null;
  employeeId: string;
  canRequest: boolean;
  onRequest: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card aria-labelledby="selected-day" className="border-line-strong">
      <CardHeader
        id="selected-day"
        label="Selected"
        title={formatWeekdayDate(date)}
        actions={record ? <StatusBadge status={record.status} label={t(`status.${record.status}`)} /> : null}
      />
      {record ? (
        <KeyValueList
          items={[
            { label: 'In', value: record.firstInAt ? formatTime(record.firstInAt) : '—' },
            { label: 'Out', value: record.lastOutAt ? formatTime(record.lastOutAt) : '—' },
            { label: 'Worked', value: formatDuration(record.workedMinutes) },
            ...(record.lateMinutes
              ? [{ label: 'After core start', value: formatDuration(record.lateMinutes) }]
              : []),
            ...(record.hasCorrection || record.hasManualEntry || record.needsReview
              ? [{ label: 'Notes', value: <RecordFlags record={record} /> }]
              : []),
          ]}
        />
      ) : (
        <p className="text-text-2">Nothing was recorded for this day.</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-4">
        {canRequest ? (
          <Button variant="secondary" onClick={onRequest}>
            Request correction
          </Button>
        ) : null}
        <Button variant="text" asChild>
          <Link to="/attendance/$employeeId/$workDate" params={{ employeeId, workDate: date }}>
            View day details
          </Link>
        </Button>
      </div>
    </Card>
  );
}
