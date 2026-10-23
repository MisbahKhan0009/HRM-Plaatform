import { Button, Card, CardHeader, KeyValueList, LoadingBlock, StatusBadge } from '@hrm/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../../../components/page-header';
import { attendanceQueries, ensureFound } from '../../../../features/attendance/api';
import { CorrectionDialog } from '../../../../features/attendance/correction-dialog';
import { EventTimeline } from '../../../../features/attendance/event-timeline';
import { RecordFlags } from '../../../../features/attendance/selected-day';
import { can, requireAny, useCan, useMe } from '../../../../lib/auth/me';
import { formatDate, formatDuration, formatTime, todayIso } from '../../../../lib/format';

export const Route = createFileRoute('/_app/attendance/$employeeId/$workDate')({
  beforeLoad: ({ context }) =>
    requireAny(context.queryClient, ['attendance.read.own', 'attendance.read.team', 'attendance.read.all']),
  loader: ({ context, params }) =>
    ensureFound(
      context.queryClient.ensureQueryData(attendanceQueries.day(params.employeeId, params.workDate)),
    ),
  pendingComponent: () => <LoadingBlock label="day" />,
  component: DayDetailPage,
});

// API-CATALOGUE §5 `GET /attendance/{employeeId}/{workDate}`: the record and every event, originals and corrections
// side by side as a timeline (COMPONENT-SPECS §16, FR-ATT-008).
function DayDetailPage() {
  const { t } = useTranslation();
  const { employeeId, workDate } = Route.useParams();
  const { data } = useSuspenseQuery(attendanceQueries.day(employeeId, workDate));
  const me = useMe();
  const canRequest = useCan('attendance.correction.request.own');
  const [requesting, setRequesting] = useState(false);
  const own = me?.employee?.id === employeeId;
  const today = todayIso();
  const back = own
    ? { label: 'My attendance', to: '/attendance' }
    : can(me, 'attendance.read.all')
      ? { label: 'Attendance records', to: '/attendance/records' }
      : { label: 'Team attendance', to: '/attendance/team' };
  const r = data.record;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={`${data.employee.name}, ${formatDate(data.workDate)}`}
        code={data.employee.employeeCode}
        breadcrumb={back}
        status={r ? <StatusBadge status={r.status} label={t(`status.${r.status}`)} /> : null}
        actions={
          own && canRequest && workDate <= today ? (
            <Button variant="secondary" onClick={() => setRequesting(true)}>
              Request correction
            </Button>
          ) : null
        }
      />
      <Card aria-labelledby="day-record">
        <CardHeader id="day-record" title="Day" />
        {r ? (
          <KeyValueList
            items={[
              { label: 'In', value: r.firstInAt ? formatTime(r.firstInAt) : '—' },
              { label: 'Out', value: r.lastOutAt ? formatTime(r.lastOutAt) : '—' },
              { label: 'Worked', value: formatDuration(r.workedMinutes) },
              { label: 'After core start', value: formatDuration(r.lateMinutes) },
              { label: 'Before core end', value: formatDuration(r.earlyLeaveMinutes) },
              {
                label: 'Day',
                value: r.isFinal ? 'Closed' : 'Open until the day closes after midnight',
              },
              ...(r.hasCorrection || r.hasManualEntry || r.needsReview
                ? [{ label: 'Notes', value: <RecordFlags record={r} /> }]
                : []),
            ]}
          />
        ) : (
          <p className="text-text-2">No record for this day yet. Days are recorded at the first check-in.</p>
        )}
        <p className="mt-4 text-sm text-text-2">
          Times in Asia/Dhaka. Lateness is shown for awareness only and never affects pay.
        </p>
      </Card>
      <Card aria-labelledby="day-events">
        <CardHeader id="day-events" title="Events" />
        <EventTimeline events={data.events} />
      </Card>
      {requesting ? (
        <CorrectionDialog
          employeeId={employeeId}
          today={today}
          workDate={workDate}
          record={r}
          onClose={() => setRequesting(false)}
        />
      ) : null}
    </div>
  );
}
