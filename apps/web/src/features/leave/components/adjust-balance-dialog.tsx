import { AdjustLeaveBalanceInputSchema } from '@hrm/contracts';
import { Alert, Button, Dialog, Field, Input, notify, Select, Textarea } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../../lib/api/client';
import { useErrorMessage } from '../../../lib/api/errors';
import { formatDays } from '../../../lib/format';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../../lib/forms';
import { leaveQueries, useAdjustBalance } from '../api';
import { EmployeePicker, type PickedEmployee } from './employee-picker';

/**
 * HR balance adjustment (US-LEAVE-007, BUSINESS-RULES 4.1): signed days with a reason, sent with an Idempotency-Key;
 * the API needs a strong session and answers with the balance after the adjustment.
 */
export function AdjustBalanceDialog({
  initial,
  year,
  onClose,
}: {
  initial: { employee: PickedEmployee | null; leaveTypeId: string };
  year: number;
  onClose: () => void;
}) {
  const adjust = useAdjustBalance();
  const errorMessage = useErrorMessage();
  const types = useQuery(leaveQueries.types());
  const [employee, setEmployee] = useState<PickedEmployee | null>(initial.employee);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useZodForm(AdjustLeaveBalanceInputSchema, {
    employeeId: initial.employee?.id ?? '',
    leaveTypeId: initial.leaveTypeId,
    year,
    amount: '',
    reason: '',
  });
  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      const after = await adjust.mutateAsync(v);
      notify.success(
        `Balance adjusted. ${after.employeeName} now has ${formatDays(after.available)} of ${after.leaveTypeName}.`,
      );
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_BALANCE') {
        form.setError('amount', {
          type: 'server',
          message: 'This would take the balance below zero, which the policy doesn’t allow.',
        });
        return;
      }
      setFormError(applyServerErrors(form, err, errorMessage));
    }
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Adjust balance"
      description="Adds or removes days with a reason. The change is recorded in the ledger and the audit log."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={adjust.isPending} onClick={() => void submit()}>
            Adjust balance
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field label="Employee" error={form.formState.errors.employeeId?.message}>
          {({ id, describedBy, invalid }) => (
            <EmployeePicker
              id={id}
              value={employee}
              describedBy={describedBy}
              invalid={invalid}
              onChange={(e) => {
                setEmployee(e);
                form.setValue('employeeId', e?.id ?? '', { shouldValidate: Boolean(e) });
              }}
            />
          )}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_120px]">
          <FormField
            control={form.control}
            name="leaveTypeId"
            label="Leave type"
            render={(p) => (
              <Select {...p}>
                <option value="">Choose a leave type</option>
                {types.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          />
          <FormField
            control={form.control}
            name="year"
            label="Leave year"
            render={(p) => (
              <Select {...p} onChange={(e) => p.onChange(Number(e.target.value))}>
                {[year - 1, year, year + 1].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="amount"
          label="Days"
          hint="Use a minus sign to remove days, for example -1.5. Halves only."
          render={(p) => <Input inputMode="decimal" autoComplete="off" className="font-mono" {...p} />}
        />
        <FormField
          control={form.control}
          name="reason"
          label="Reason"
          hint="Recorded in the ledger and the audit log."
          render={(p) => <Textarea maxLength={500} {...p} />}
        />
        {form.formState.errors.root ? <Alert tone="bad">{form.formState.errors.root.message}</Alert> : null}
      </form>
    </Dialog>
  );
}
