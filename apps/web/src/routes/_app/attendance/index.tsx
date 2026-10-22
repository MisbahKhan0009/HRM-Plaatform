import { Button, EmptyState, LoadingBlock } from '@hrm/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Clock } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { PageHeader } from '../../../components/page-header';
import { attendanceQueries } from '../../../features/attendance/api';
import { CorrectionDialog } from '../../../features/attendance/correction-dialog';
import { monthOf, monthRange } from '../../../features/attendance/dates';
import { scheduleLine } from '../../../features/attendance/labels';
import { MonthView } from '../../../features/attendance/month-view';
import { MyCorrections } from '../../../features/attendance/my-corrections';
import { SelectedDay } from '../../../features/attendance/selected-day';
import { TodayPanel } from '../../../features/attendance/today-panel';
import { meQuery, requireAny, useCan, useMe } from '../../../lib/auth/me';
import { todayIso } from '../../../lib/format';

const currentMonth = () => monthOf(todayIso());

const search = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .default(currentMonth)
    .catch(currentMonth)
    .transform((m) => (m > currentMonth() ? currentMonth() : m)),
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/_app/attendance/')({
  validateSearch: search,
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['attendance.read.own']),
  loaderDeps: ({ search: s }) => ({ month: s.month }),
  loader: async ({ context, deps }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me?.employee) return;
    await context.queryClient.ensureQueryData(attendanceQueries.me(monthRange(deps.month, todayIso())));
  },
  pendingComponent: () => <LoadingBlock label="attendance" />,
  component: MyAttendancePage,
});

// INFORMATION-ARCHITECTURE §1 `/attendance`; SCREEN-INVENTORY §3.1; USER-FLOWS §3 and §4.
function MyAttendancePage() {
  const me = useMe();
  if (!me?.employee) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="My attendance" />
        <EmptyState
          icon={Clock}
          title="No employee record"
          description="Attendance is kept for employees. Ask HR to link your account to your employee record."
        />
      </div>
    );
  }
  return <MyAttendance employeeId={me.employee.id} />;
}

function MyAttendance({ employeeId }: { employeeId: string }) {
  const params = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const today = todayIso();
  const { data } = useSuspenseQuery(attendanceQueries.me(monthRange(params.month, today)));
  const canPunch = useCan('attendance.check_in.own');
  const canRequest = useCan('attendance.correction.request.own');
  const [requesting, setRequesting] = useState<string | null>(null);
  const selected = params.day && params.day <= today ? params.day : undefined;
  const recordFor = (d: string) => data.data.find((r) => r.workDate === d) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My attendance"
        description={scheduleLine(data.today.schedule) ?? 'No work schedule applies to you yet. Ask HR.'}
        actions={
          canRequest ? (
            <Button variant="secondary" onClick={() => setRequesting(selected ?? today)}>
              Request correction
            </Button>
          ) : null
        }
      />
      <TodayPanel today={data.today} canPunch={canPunch} />
      <div className="flex flex-wrap items-start gap-6">
        <div className="min-w-0 flex-[999_1_560px]">
          <MonthView
            month={params.month}
            today={today}
            records={data.data}
            selected={selected}
            onSelect={(day) => void navigate({ search: { ...params, day }, replace: true })}
            onMonth={(month) => void navigate({ search: { month } })}
          />
        </div>
        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-6">
          {selected ? (
            <SelectedDay
              date={selected}
              record={recordFor(selected)}
              employeeId={employeeId}
              canRequest={canRequest}
              onRequest={() => setRequesting(selected)}
            />
          ) : null}
          <MyCorrections employeeId={employeeId} canRequest={canRequest} />
        </div>
      </div>
      {requesting ? (
        <CorrectionDialog
          employeeId={employeeId}
          today={today}
          workDate={requesting}
          record={recordFor(requesting) ?? (requesting === today ? data.today.record : null)}
          onClose={() => setRequesting(null)}
        />
      ) : null}
    </div>
  );
}
