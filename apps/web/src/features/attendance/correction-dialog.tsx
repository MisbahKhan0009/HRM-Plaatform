import type { AttendanceRecord } from '@hrm/contracts';
import { Button, Dialog, Input, LoadingBlock, notify, Textarea } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { useErrorMessage } from '../../lib/api/errors';
import { formatDate } from '../../lib/format';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../lib/forms';
import { attendanceQueries, useRequestCorrection } from './api';
import { dhakaTime, proposedInstants } from './dates';
import { EventTimeline } from './event-timeline';

const time = z.string().regex(/^(\d{2}:\d{2})?$/, 'Enter a time such as 09:30.');

/** The form edits wall-clock times; `proposedInstants` turns them into the contract's instants on submit. */
const CorrectionFormSchema = z
  .object({
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.'),
    proposedCheckInAt: time,
    proposedCheckOutAt: time,
    reason: z
      .string()
      .trim()
      .min(5, 'Explain what happened in at least 5 characters.')
      .max(1000, 'Keep the reason under 1,000 characters.'),
  })
  .refine((v) => Boolean(v.proposedCheckInAt || v.proposedCheckOutAt), {
    message: 'Propose a check-in or a check-out time.',
    path: ['proposedCheckInAt'],
  });

/**
 * Request a correction of one of my days (USER-FLOWS §4): the original events are shown read-only above the form,
 * and the times start from the record so the employee only changes what is wrong.
 */
export function CorrectionDialog({
  employeeId,
  today,
  workDate,
  record,
  onClose,
}: {
  employeeId: string;
  today: string;
  workDate: string;
  record: AttendanceRecord | null;
  onClose: () => void;
}) {
  const request = useRequestCorrection();
  const errorMessage = useErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useZodForm(CorrectionFormSchema, {
    workDate,
    proposedCheckInAt: record?.firstInAt ? dhakaTime(record.firstInAt) : '',
    proposedCheckOutAt: record?.lastOutAt ? dhakaTime(record.lastOutAt) : '',
    reason: '',
  });
  const date = form.watch('workDate');
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;
  const day = useQuery({ ...attendanceQueries.day(employeeId, date), enabled: validDate });

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await request.mutateAsync({
        workDate: v.workDate,
        ...proposedInstants(v.workDate, v.proposedCheckInAt, v.proposedCheckOutAt),
        reason: v.reason,
      });
      notify.success('Correction requested');
      onClose();
    } catch (err) {
      setFormError(applyServerErrors(form, err, errorMessage));
    }
  });

  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title="Request correction"
      description="Your manager reviews the request. The original record is kept."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={request.isPending} onClick={() => void submit()}>
            Submit request
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <FormField
          control={form.control}
          name="workDate"
          label="Date"
          hint="Today or a recent day. HR sets how far back corrections are accepted."
          render={(p) => <Input type="date" max={today} {...p} />}
        />
        <section aria-labelledby="original-events" className="rounded-control border border-line p-3">
          <h3 id="original-events" className="mb-2 text-sm font-medium text-text-2">
            Recorded on {validDate ? formatDate(date) : 'this day'}
          </h3>
          {!validDate ? (
            <p className="text-sm text-text-2">Choose a date to see what was recorded.</p>
          ) : day.isPending ? (
            <LoadingBlock label="events" rows={2} />
          ) : (
            <EventTimeline events={day.data?.events ?? []} />
          )}
        </section>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="proposedCheckInAt"
            label="Check-in"
            optional
            render={(p) => <Input type="time" className="font-mono" {...p} />}
          />
          <FormField
            control={form.control}
            name="proposedCheckOutAt"
            label="Check-out"
            optional
            hint="Earlier than the check-in means the next morning."
            render={(p) => <Input type="time" className="font-mono" {...p} />}
          />
        </div>
        <FormField
          control={form.control}
          name="reason"
          label="Reason"
          render={(p) => <Textarea rows={3} {...p} />}
        />
      </form>
    </Dialog>
  );
}
