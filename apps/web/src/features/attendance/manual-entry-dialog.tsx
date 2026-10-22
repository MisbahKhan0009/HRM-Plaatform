import { Button, Dialog, Input, notify, Select, Textarea } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { useErrorMessage } from '../../lib/api/errors';
import { todayIso } from '../../lib/format';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../lib/forms';
import { attendanceQueries, useCreateManualEntry } from './api';
import { addDays, proposedInstants } from './dates';

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Enter a time such as 09:30.');

/** Wall-clock form for `POST /attendance/manual-entries` (FR-ATT-009): a full pair with a reason. */
const ManualEntryFormSchema = z.object({
  employeeId: z.string().min(1, 'Choose an employee.'),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.'),
  checkInAt: hhmm,
  checkOutAt: hhmm,
  reason: z
    .string()
    .trim()
    .min(5, 'Explain the entry in at least 5 characters.')
    .max(1000, 'Keep the reason under 1,000 characters.'),
});

/**
 * HR records a missed day (SCREEN-INVENTORY §3.3, `attendance.manage`). The entry is kept next to the original
 * events and the day is recomputed by the server.
 */
export function ManualEntryDialog({ onClose }: { onClose: () => void }) {
  const today = todayIso();
  const create = useCreateManualEntry();
  const errorMessage = useErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  // Employees with any day in the last two months; the close-day job gives every employed person a daily record.
  const employees = useQuery(attendanceQueries.summary({ from: addDays(today, -62), to: today }));
  const form = useZodForm(ManualEntryFormSchema, {
    employeeId: '',
    workDate: addDays(today, -1),
    checkInAt: '',
    checkOutAt: '',
    reason: '',
  });
  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    const { proposedCheckInAt, proposedCheckOutAt } = proposedInstants(v.workDate, v.checkInAt, v.checkOutAt);
    try {
      await create.mutateAsync({
        employeeId: v.employeeId,
        workDate: v.workDate,
        checkInAt: proposedCheckInAt as string,
        checkOutAt: proposedCheckOutAt as string,
        reason: v.reason,
      });
      notify.success('Manual entry added');
      onClose();
    } catch (err) {
      setFormError(applyServerErrors(form, err, errorMessage));
    }
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add manual entry"
      description="The entry is added next to the recorded events, which stay unchanged. Times are in Asia/Dhaka."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={() => void submit()}>
            Add entry
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <FormField
          control={form.control}
          name="employeeId"
          label="Employee"
          render={(p) => (
            <Select {...p}>
              <option value="">Choose an employee</option>
              {employees.data?.data.map((r) => (
                <option key={r.employee.id} value={r.employee.id}>
                  {r.employee.name} · {r.employee.employeeCode}
                </option>
              ))}
            </Select>
          )}
        />
        <FormField
          control={form.control}
          name="workDate"
          label="Date"
          render={(p) => <Input type="date" max={today} {...p} />}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="checkInAt"
            label="Check-in"
            render={(p) => <Input type="time" className="font-mono" {...p} />}
          />
          <FormField
            control={form.control}
            name="checkOutAt"
            label="Check-out"
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
