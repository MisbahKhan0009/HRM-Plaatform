import {
  CreateWorkScheduleInputSchema,
  UpdateWorkScheduleInputSchema,
  type WorkSchedule,
} from '@hrm/contracts';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  Input,
  LoadingBlock,
  notify,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../../components/page-header';
import { orgQueries, useSaveSchedule, WEEKDAYS } from '../../../features/organization/api';
import { useErrorMessage } from '../../../lib/api/errors';
import { requireAny, useCan } from '../../../lib/auth/me';
import { formatDuration } from '../../../lib/format';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../../lib/forms';

export const Route = createFileRoute('/_app/settings/work-schedules')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['attendance.manage', 'attendance.read.all']),
  component: SchedulesPage,
});

const days = (list: number[]) => list.map((d) => WEEKDAYS[d]?.slice(0, 3)).join(', ');

// D-005 (Sun–Thu), D-010 (flexible hours with a core window). Changing a schedule does not rewrite closed days.
function SchedulesPage() {
  const canEdit = useCan('attendance.manage');
  const list = useQuery(orgQueries.schedules());
  const [editing, setEditing] = useState<WorkSchedule | 'new' | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Work schedules"
        description="Working days, core hours and the daily minimum. Changes apply to days not yet closed."
        actions={
          canEdit ? (
            <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => setEditing('new')}>
              Add schedule
            </Button>
          ) : null
        }
      />
      <TableContainer>
        {list.isPending ? (
          <div className="p-4">
            <LoadingBlock label="schedules" />
          </div>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Working days</TH>
                <TH>Core hours</TH>
                <TH numeric>Daily minimum</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {list.data?.map((s) => (
                <TR key={s.id}>
                  <TD>
                    <span className="flex items-center gap-2">
                      {s.name}
                      {s.isDefault ? <Badge tone="info">Default</Badge> : null}
                      {!s.isActive ? <Badge>Inactive</Badge> : null}
                    </span>
                  </TD>
                  <TD>{days(s.workingDays)}</TD>
                  <TD className="font-mono whitespace-nowrap">
                    {s.coreStart}–{s.coreEnd}
                  </TD>
                  <TD numeric>{formatDuration(s.minDailyMinutes)}</TD>
                  <TD className="text-right">
                    {canEdit ? (
                      <Button variant="text" onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </TableContainer>
      {editing ? (
        <ScheduleDialog schedule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function ScheduleDialog({ schedule, onClose }: { schedule: WorkSchedule | null; onClose: () => void }) {
  const save = useSaveSchedule();
  const errorMessage = useErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useZodForm(schedule ? UpdateWorkScheduleInputSchema : CreateWorkScheduleInputSchema, {
    name: schedule?.name ?? '',
    workingDays: schedule?.workingDays ?? [0, 1, 2, 3, 4],
    coreStart: schedule?.coreStart ?? '10:00',
    coreEnd: schedule?.coreEnd ?? '16:00',
    minDailyMinutes: schedule?.minDailyMinutes ?? 480,
    breakMinutes: schedule?.breakMinutes ?? 0,
    ...(schedule ? { version: schedule.version } : { isDefault: false }),
  } as never);
  const submit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync(
        schedule ? { id: schedule.id, update: values as never } : { create: values as never },
      );
      notify.success(schedule ? 'Schedule saved' : 'Schedule added');
      onClose();
    } catch (err) {
      setFormError(applyServerErrors(form, err, errorMessage));
    }
  });
  const field = (name: string) => name as never;
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={schedule ? `Edit ${schedule.name}` : 'Add schedule'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => void submit()}>
            {schedule ? 'Save changes' : 'Add schedule'}
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <FormField
          control={form.control}
          name={field('name')}
          label="Name"
          render={(p) => <Input {...p} />}
        />
        <FormField
          control={form.control}
          name={field('workingDays')}
          label="Working days"
          render={(p) => {
            const value = (p.value as unknown as number[]) || [];
            return (
              <div id={p.id} className="flex flex-wrap gap-3">
                {WEEKDAYS.map((name, d) => (
                  <Checkbox
                    key={name}
                    label={name.slice(0, 3)}
                    checked={value.includes(d)}
                    onChange={(e) =>
                      p.onChange(e.target.checked ? [...value, d].sort() : value.filter((x) => x !== d))
                    }
                  />
                ))}
              </div>
            );
          }}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name={field('coreStart')}
            label="Core hours start"
            render={(p) => <Input type="time" {...p} />}
          />
          <FormField
            control={form.control}
            name={field('coreEnd')}
            label="Core hours end"
            render={(p) => <Input type="time" {...p} />}
          />
          <FormField
            control={form.control}
            name={field('minDailyMinutes')}
            label="Daily minimum (minutes)"
            render={(p) => (
              <Input
                type="number"
                min={0}
                max={1440}
                {...p}
                onChange={(e) => p.onChange(Number(e.target.value))}
              />
            )}
          />
          <FormField
            control={form.control}
            name={field('breakMinutes')}
            label="Break (minutes)"
            render={(p) => (
              <Input
                type="number"
                min={0}
                max={480}
                {...p}
                onChange={(e) => p.onChange(Number(e.target.value))}
              />
            )}
          />
        </div>
      </form>
    </Dialog>
  );
}
