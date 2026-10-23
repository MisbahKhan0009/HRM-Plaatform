import {
  CreateHolidayInputSchema,
  type Holiday,
  holidayTypeValues,
  UpdateHolidayInputSchema,
} from '@hrm/contracts';
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Input,
  LoadingBlock,
  notify,
  Select,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { CalendarDays, Plus } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { PageHeader } from '../../../components/page-header';
import { orgQueries, useDeleteHoliday, useSaveHoliday } from '../../../features/organization/api';
import { useErrorMessage } from '../../../lib/api/errors';
import { requireAny, useCan } from '../../../lib/auth/me';
import { formatDate, todayIso } from '../../../lib/format';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../../lib/forms';

const thisYear = Number(todayIso().slice(0, 4));

export const Route = createFileRoute('/_app/settings/holidays')({
  validateSearch: z.object({ year: z.number().int().min(2000).max(2100).default(thisYear).catch(thisYear) }),
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['settings.read']),
  component: HolidaysPage,
});

const TYPE_LABEL: Record<(typeof holidayTypeValues)[number], string> = {
  public: 'Public',
  festival: 'Festival',
  company: 'Company',
  optional: 'Optional',
};

function HolidaysPage() {
  const { year } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const canEdit = useCan('settings.hr.manage');
  const list = useQuery(orgQueries.holidays(year));
  const remove = useDeleteHoliday();
  const errorMessage = useErrorMessage();
  const [editing, setEditing] = useState<Holiday | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Holiday | null>(null);
  const today = todayIso();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Holidays"
        description="Holidays are excluded from leave days and marked in attendance."
        actions={
          canEdit ? (
            <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => setEditing('new')}>
              Add holiday
            </Button>
          ) : null
        }
      />
      <TableContainer
        toolbar={
          <Select
            aria-label="Year"
            className="w-32"
            value={year}
            onChange={(e) => void navigate({ search: { year: Number(e.target.value) } })}
          >
            {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        }
      >
        {list.isPending ? (
          <div className="p-4">
            <LoadingBlock label="holidays" />
          </div>
        ) : !list.data?.length ? (
          <EmptyState
            icon={CalendarDays}
            variant="no-results"
            title={`No holidays in ${year}`}
            description="Add public and company holidays for the year."
            className="border-0"
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Name</TH>
                <TH>Type</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {list.data.map((h) => (
                <TR key={h.id}>
                  <TD>
                    <time dateTime={h.date}>{formatDate(h.date)}</time>
                  </TD>
                  <TD>{h.name}</TD>
                  <TD>{TYPE_LABEL[h.type]}</TD>
                  <TD className="text-right whitespace-nowrap">
                    {canEdit ? (
                      <>
                        <Button variant="text" onClick={() => setEditing(h)}>
                          Edit
                        </Button>
                        {h.date > today ? (
                          <Button variant="text" className="ml-4 text-bad" onClick={() => setDeleting(h)}>
                            Delete
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </TableContainer>
      {editing ? (
        <HolidayDialog holiday={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete holiday"
        description={
          deleting ? `${deleting.name} on ${formatDate(deleting.date)} will no longer be a holiday.` : ''
        }
        confirmLabel="Delete holiday"
        loading={remove.isPending}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            notify.success('Holiday deleted');
            setDeleting(null);
          } catch (err) {
            notify.error(errorMessage(err));
          }
        }}
      />
    </div>
  );
}

function HolidayDialog({ holiday, onClose }: { holiday: Holiday | null; onClose: () => void }) {
  const save = useSaveHoliday();
  const errorMessage = useErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useZodForm(holiday ? UpdateHolidayInputSchema : CreateHolidayInputSchema, {
    name: holiday?.name ?? '',
    type: holiday?.type ?? 'public',
    ...(holiday ? { version: holiday.version } : { date: '' }),
  } as never);
  const submit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync(
        holiday ? { id: holiday.id, update: values as never } : { create: values as never },
      );
      notify.success(holiday ? 'Holiday saved' : 'Holiday added');
      onClose();
    } catch (err) {
      setFormError(applyServerErrors(form, err, errorMessage));
    }
  });
  const field = (name: string) => name as never;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={holiday ? `Edit ${holiday.name}` : 'Add holiday'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => void submit()}>
            {holiday ? 'Save changes' : 'Add holiday'}
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <form className="flex flex-col gap-4" onSubmit={submit}>
        {!holiday ? (
          <FormField
            control={form.control}
            name={field('date')}
            label="Date"
            render={(p) => <Input type="date" {...p} />}
          />
        ) : null}
        <FormField
          control={form.control}
          name={field('name')}
          label="Name"
          render={(p) => <Input {...p} />}
        />
        <FormField
          control={form.control}
          name={field('type')}
          label="Type"
          render={(p) => (
            <Select {...p}>
              {holidayTypeValues.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          )}
        />
      </form>
    </Dialog>
  );
}
