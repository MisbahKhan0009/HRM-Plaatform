import {
  EffectiveActionInputSchema,
  type EmployeeFull,
  HireEmployeeInputSchema,
  SeparateEmployeeInputSchema,
  separationTypeValues,
} from '@hrm/contracts';
import {
  Button,
  ConfirmDialog,
  Dialog,
  Input,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
  notify,
  Select,
  Textarea,
} from '@hrm/ui';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { StepUpCancelledError } from '../../../lib/api/client';
import { useErrorMessage } from '../../../lib/api/errors';
import { formatDate, todayIso } from '../../../lib/format';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../../lib/forms';
import { type LifecycleCommand, useLifecycleAction } from '../api';
import { omitBlank } from '../forms';
import { SEPARATION_TYPE_LABEL } from '../labels';

export type EmployeeDialog =
  | 'start-preboarding'
  | 'hire'
  | 'confirm'
  | 'start-notice'
  | 'separate'
  | 'rehire'
  | 'archive'
  | 'event'
  | 'invite';

/** Lifecycle actions available from each status (DOMAIN-MODEL §5.2), in menu order. */
export const ACTIONS_FOR_STATUS: Record<EmployeeFull['status'], EmployeeDialog[]> = {
  draft: ['start-preboarding'],
  preboarding: ['hire'],
  probation: ['confirm', 'separate'],
  active: ['start-notice', 'separate'],
  notice_period: ['separate'],
  separated: ['rehire', 'archive'],
  archived: [],
};

const ACTION_LABEL: Record<EmployeeDialog, string> = {
  'start-preboarding': 'Start preboarding',
  hire: 'Hire',
  confirm: 'Confirm after probation',
  'start-notice': 'Start notice period',
  separate: 'Start separation',
  rehire: 'Rehire',
  archive: 'Archive',
  event: 'Record employment event',
  invite: 'Invite to sign in',
};

/** "More" menu on the record header (SCREEN-INVENTORY §8.4 secondary actions). */
export function EmployeeActionsMenu({
  actions,
  onSelect,
}: {
  actions: EmployeeDialog[];
  onSelect: (a: EmployeeDialog) => void;
}) {
  if (!actions.length) return null;
  const destructive = new Set<EmployeeDialog>(['separate', 'archive']);
  const safe = actions.filter((a) => !destructive.has(a));
  const risky = actions.filter((a) => destructive.has(a));
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button variant="secondary">
          More actions
          <ChevronDown aria-hidden="true" />
        </Button>
      </MenuTrigger>
      <MenuContent>
        {safe.map((a) => (
          <MenuItem key={a} onSelect={() => onSelect(a)}>
            {ACTION_LABEL[a]}
          </MenuItem>
        ))}
        {safe.length && risky.length ? <MenuSeparator /> : null}
        {risky.map((a) => (
          <MenuItem key={a} destructive onSelect={() => onSelect(a)}>
            {ACTION_LABEL[a]}
          </MenuItem>
        ))}
      </MenuContent>
    </MenuRoot>
  );
}

type DialogProps = { employee: EmployeeFull; onClose: () => void };

function useRun(employee: EmployeeFull, onClose: () => void) {
  const mutation = useLifecycleAction();
  const errorMessage = useErrorMessage();
  const run = async (cmd: LifecycleCommand, success: string, onError?: (err: unknown) => void) => {
    try {
      await mutation.mutateAsync({ ...cmd, id: employee.id } as LifecycleCommand & { id: string });
      notify.success(success);
      onClose();
    } catch (err) {
      if (err instanceof StepUpCancelledError) return;
      if (onError) onError(err);
      else notify.error(errorMessage(err));
    }
  };
  return { run, pending: mutation.isPending, errorMessage };
}

/** Effective-dated wording: today or earlier applies now; a future date is scheduled. */
const whenText = (date: string, status: string) =>
  date > todayIso()
    ? `Scheduled: they become ${status} on ${formatDate(date)}.`
    : `They become ${status} now.`;

export function StartPreboardingDialog({ employee, onClose }: DialogProps) {
  const { run, pending } = useRun(employee, onClose);
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      tone="primary"
      title={`Start preboarding for ${employee.displayName}?`}
      description="Their status changes to Preboarding. Hire them once their joining date is confirmed."
      confirmLabel="Start preboarding"
      loading={pending}
      onConfirm={() =>
        run({ action: 'start-preboarding', input: { version: employee.version } }, 'Preboarding started')
      }
    />
  );
}

export function ArchiveDialog({ employee, onClose }: DialogProps) {
  const { run, pending } = useRun(employee, onClose);
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Archive ${employee.displayName}?`}
      description="They'll be hidden from lists. Their attendance, leave, payroll and documents stay available in reports and the audit log."
      confirmLabel="Archive employee"
      loading={pending}
      onConfirm={() => run({ action: 'archive', input: { version: employee.version } }, 'Employee archived')}
    />
  );
}

const H = HireEmployeeInputSchema.shape;
const HireForm = z
  .object({
    effectiveDate: H.effectiveDate,
    probationEndDate: omitBlank(H.probationEndDate),
    reason: omitBlank(H.reason),
  })
  .refine((v) => !v.probationEndDate || v.probationEndDate > v.effectiveDate, {
    message: 'Probation must end after the hire date.',
    path: ['probationEndDate'],
  });

export function HireDialog({ employee, onClose }: DialogProps) {
  const { run, pending, errorMessage } = useRun(employee, onClose);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useZodForm(HireForm, {
    effectiveDate: employee.joiningDate ?? todayIso(),
    probationEndDate: employee.probationEndDate ?? '',
    reason: '',
  });
  const submit = form.handleSubmit((v) =>
    run(
      { action: 'hire', input: { ...v, version: employee.version } },
      v.effectiveDate > todayIso() ? 'Hire scheduled' : 'Employee hired',
      (err) => setFormError(applyServerErrors(form, err, errorMessage)),
    ),
  );
  const date = String(form.watch('effectiveDate') ?? '');
  const probation = Boolean(form.watch('probationEndDate'));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Hire ${employee.displayName}`}
      description="With a probation end date they start in Probation; without one they start as Active."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>
            Hire
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <FormField
          control={form.control}
          name="effectiveDate"
          label="Hire date"
          hint={date ? whenText(date, probation ? 'Probation' : 'Active') : undefined}
          render={(p) => <Input type="date" {...p} />}
        />
        <FormField
          control={form.control}
          name="probationEndDate"
          label="Probation end date"
          optional
          render={(p) => <Input type="date" {...p} />}
        />
        <FormField
          control={form.control}
          name="reason"
          label="Note"
          optional
          render={(p) => <Textarea {...p} />}
        />
      </form>
    </Dialog>
  );
}

const A = EffectiveActionInputSchema.shape;
const EffectiveForm = z.object({ effectiveDate: A.effectiveDate, reason: omitBlank(A.reason) });

type EffectiveAction = 'confirm' | 'start-notice' | 'rehire';
const EFFECTIVE_COPY: Record<
  EffectiveAction,
  { title: string; description: string; dateLabel: string; confirm: string; status: string; done: string }
> = {
  confirm: {
    title: 'Confirm after probation',
    description: 'Their status changes from Probation to Active.',
    dateLabel: 'Confirmation date',
    confirm: 'Confirm employment',
    status: 'Active',
    done: 'Employment confirmed',
  },
  'start-notice': {
    title: 'Start notice period',
    description:
      'Their status changes to Notice period. Record the separation when the last working day is known.',
    dateLabel: 'Notice start date',
    confirm: 'Start notice period',
    status: 'Notice period',
    done: 'Notice period started',
  },
  rehire: {
    title: 'Rehire',
    description: 'They keep their employee code and history; the rehire date becomes their joining date.',
    dateLabel: 'Rehire date',
    confirm: 'Rehire',
    status: 'Active',
    done: 'Employee rehired',
  },
};

export function EffectiveActionDialog({
  employee,
  onClose,
  action,
}: DialogProps & { action: EffectiveAction }) {
  const copy = EFFECTIVE_COPY[action];
  const { run, pending, errorMessage } = useRun(employee, onClose);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useZodForm(EffectiveForm, {
    effectiveDate: action === 'confirm' ? (employee.probationEndDate ?? todayIso()) : todayIso(),
    reason: '',
  });
  const submit = form.handleSubmit((v) =>
    run(
      { action, input: { ...v, version: employee.version } } as LifecycleCommand,
      v.effectiveDate > todayIso() ? `${copy.title}: scheduled` : copy.done,
      (err) => setFormError(applyServerErrors(form, err, errorMessage)),
    ),
  );
  const date = String(form.watch('effectiveDate') ?? '');
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${copy.title}: ${employee.displayName}`}
      description={copy.description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>
            {copy.confirm}
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <FormField
          control={form.control}
          name="effectiveDate"
          label={copy.dateLabel}
          hint={date ? whenText(date, copy.status) : undefined}
          render={(p) => <Input type="date" {...p} />}
        />
        <FormField
          control={form.control}
          name="reason"
          label="Note"
          optional
          render={(p) => <Textarea {...p} />}
        />
      </form>
    </Dialog>
  );
}

const S = SeparateEmployeeInputSchema.shape;
const SeparateForm = z.object({
  separationDate: S.separationDate,
  separationType: z.enum(separationTypeValues, { message: 'Choose the exit type.' }),
  reason: omitBlank(S.reason),
});

/** Level 4 confirmation (COMPONENT-SPECS §12): type the employee code; the API also asks for a fresh sign-in. */
export function SeparateDialog({ employee, onClose }: DialogProps) {
  const { run, pending, errorMessage } = useRun(employee, onClose);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useZodForm(SeparateForm, {
    separationDate: todayIso(),
    separationType: '' as never,
    reason: '',
  });
  const submit = form.handleSubmit((v) =>
    run(
      { action: 'separate', input: { ...v, version: employee.version } },
      v.separationDate > todayIso() ? 'Separation scheduled' : 'Separation recorded',
      (err) => setFormError(applyServerErrors(form, err, errorMessage)),
    ),
  );
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Start separation for ${employee.displayName}?`}
      description="Their status becomes Separated after the last working day, and sign-in access ends automatically. Their history is kept."
      confirmLabel="Record separation"
      typeToConfirm={employee.employeeCode}
      loading={pending}
      onConfirm={() => submit()}
    >
      <FormError message={formError} />
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <FormField
          control={form.control}
          name="separationType"
          label="Exit type"
          render={(p) => (
            <Select {...p} onChange={(e) => p.onChange(e.target.value)}>
              <option value="">Choose…</option>
              {separationTypeValues.map((s) => (
                <option key={s} value={s}>
                  {SEPARATION_TYPE_LABEL[s]}
                </option>
              ))}
            </Select>
          )}
        />
        <FormField
          control={form.control}
          name="separationDate"
          label="Last working day"
          hint="Paid and inclusive. A future date is scheduled."
          render={(p) => <Input type="date" {...p} />}
        />
        <FormField
          control={form.control}
          name="reason"
          label="Note"
          optional
          render={(p) => <Textarea {...p} />}
        />
      </form>
    </ConfirmDialog>
  );
}
