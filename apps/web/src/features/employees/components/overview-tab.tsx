import { type EmployeeDetail, type EmployeeFull, InviteUserInputSchema } from '@hrm/contracts';
import { Alert, Button, Card, CardHeader, Dialog, Input, KeyValueList, notify, StatusBadge } from '@hrm/ui';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StepUpCancelledError } from '../../../lib/api/client';
import { useErrorMessage } from '../../../lib/api/errors';
import { useCan } from '../../../lib/auth/me';
import { formatDate, formatDateTime } from '../../../lib/format';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../../lib/forms';
import { useInviteEmployee, useUpdateEmployee } from '../api';
import { employeeFormDefaults, employeeFormSchema } from '../forms';
import { useRequiredEmployeeFields } from '../hooks';
import { GENDER_LABEL, SEPARATION_TYPE_LABEL } from '../labels';
import { EmployeeFormFields } from './employee-form-fields';

const dateOrDash = (d: string | null | undefined) => (d ? formatDate(d) : '—');

/** Overview tab (SCREEN-INVENTORY §8.4): key facts, personal details, sign-in account. Never salary. */
export function OverviewTab({ employee, onInvite }: { employee: EmployeeDetail; onInvite: () => void }) {
  const { t } = useTranslation();
  const canInvite = useCan('user.manage');
  const canOpen = useCan('employee.read.all', 'employee.read.team');
  const full = employee.view === 'full' ? employee : null;
  const personal = employee.view === 'basic' ? null : employee;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <Card aria-labelledby="h-employment">
        <CardHeader id="h-employment" title="Employment" />
        <KeyValueList
          items={[
            {
              label: 'Status',
              value: <StatusBadge status={employee.status} label={t(`status.${employee.status}`)} />,
            },
            { label: 'Joined', value: dateOrDash(employee.joiningDate) },
            ...(personal?.probationEndDate
              ? [{ label: 'Probation ends', value: formatDate(personal.probationEndDate) }]
              : []),
            { label: 'Department', value: employee.department?.name ?? '—' },
            { label: 'Position', value: employee.position?.title ?? '—' },
            {
              label: 'Manager',
              value: employee.manager ? (
                canOpen ? (
                  <Link
                    to="/employees/$employeeId"
                    params={{ employeeId: employee.manager.id }}
                    className="text-link underline-offset-4 hover:underline"
                  >
                    {employee.manager.name}
                  </Link>
                ) : (
                  employee.manager.name
                )
              ) : (
                '—'
              ),
            },
            { label: 'Work email', value: employee.workEmail ?? '—' },
            { label: 'Work phone', value: employee.workPhone ?? '—' },
            ...(personal?.separationDate
              ? [{ label: 'Last working day', value: formatDate(personal.separationDate) }]
              : []),
            ...(full?.separationType
              ? [{ label: 'Exit type', value: SEPARATION_TYPE_LABEL[full.separationType] }]
              : []),
            ...(full?.archivedAt ? [{ label: 'Archived', value: formatDateTime(full.archivedAt) }] : []),
          ]}
        />
      </Card>
      {personal ? (
        <Card aria-labelledby="h-personal">
          <CardHeader id="h-personal" title="Personal" />
          <KeyValueList
            items={[
              { label: 'Legal name', value: `${employee.firstName} ${employee.lastName}` },
              { label: 'Preferred name', value: employee.preferredName ?? '—' },
              { label: 'Date of birth', value: dateOrDash(personal.dateOfBirth) },
              { label: 'Gender', value: personal.gender ? GENDER_LABEL[personal.gender] : '—' },
            ]}
          />
        </Card>
      ) : null}
      {full ? (
        <Card aria-labelledby="h-account">
          <CardHeader
            id="h-account"
            title="Sign-in account"
            actions={
              full.account ? (
                <StatusBadge status={full.account.status} label={t(`status.${full.account.status}`)} />
              ) : null
            }
          />
          {full.account ? (
            <p className="text-text-2">
              {full.account.status === 'invited'
                ? 'Invitation sent. It can be resent from Settings, Users.'
                : 'Roles, sessions and sign-in methods are managed in Settings, Users.'}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-text-2">No sign-in account. Records can exist without one.</p>
              {canInvite && full.status !== 'archived' && full.status !== 'separated' ? (
                <Button variant="secondary" size="sm" className="w-fit" onClick={onInvite}>
                  Invite to sign in
                </Button>
              ) : null}
            </div>
          )}
        </Card>
      ) : null}
      <p className="text-sm text-text-2 lg:col-span-2">Last updated {formatDateTime(employee.updatedAt)}.</p>
    </div>
  );
}

const PRE_HIRE = new Set(['draft', 'preboarding']);

/** Edit (Overview primary). Department, position and manager change through employment events once hired. */
export function EditEmployeeDialog({ employee, onClose }: { employee: EmployeeFull; onClose: () => void }) {
  const required = useRequiredEmployeeFields();
  const schema = useMemo(() => employeeFormSchema(required), [required]);
  const form = useZodForm(schema, employeeFormDefaults(employee));
  const save = useUpdateEmployee(employee.id);
  const errorMessage = useErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const orgEditable = PRE_HIRE.has(employee.status);
  const submit = form.handleSubmit(async (v) => {
    const { departmentId, positionId, managerId, ...rest } = v;
    try {
      await save.mutateAsync({
        ...rest,
        ...(orgEditable ? { departmentId, positionId, managerId } : {}),
        version: employee.version,
      });
      notify.success('Employee saved');
      onClose();
    } catch (err) {
      if (err instanceof StepUpCancelledError) return;
      setFormError(applyServerErrors(form, err, errorMessage));
    }
  });
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={`Edit ${employee.displayName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => void submit()}>
            Save changes
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
        <section aria-labelledby="e-identity" className="flex flex-col gap-3">
          <h3 id="e-identity" className="font-display text-[17px] font-semibold">
            Identity
          </h3>
          <EmployeeFormFields control={form.control} section="identity" required={required} />
        </section>
        <section aria-labelledby="e-employment" className="flex flex-col gap-3">
          <h3 id="e-employment" className="font-display text-[17px] font-semibold">
            Employment
          </h3>
          {orgEditable ? (
            <EmployeeFormFields
              control={form.control}
              section="employment"
              required={required}
              selfId={employee.id}
              manager={employee.manager}
            />
          ) : (
            <Alert tone="info">
              To change department, position or manager, record an employment event so the change keeps its
              effective date.
            </Alert>
          )}
        </section>
        <section aria-labelledby="e-contact" className="flex flex-col gap-3">
          <h3 id="e-contact" className="font-display text-[17px] font-semibold">
            Work contact
          </h3>
          <EmployeeFormFields control={form.control} section="work-contact" required={required} />
        </section>
      </form>
    </Dialog>
  );
}

const InviteForm = InviteUserInputSchema.pick({ email: true, name: true });

/** Invite to sign in (USER-FLOWS 2 step 1): email prefilled with the work email; roles are set in Settings. */
export function InviteDialog({ employee, onClose }: { employee: EmployeeFull; onClose: () => void }) {
  const invite = useInviteEmployee();
  const errorMessage = useErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useZodForm(InviteForm, { email: employee.workEmail ?? '', name: employee.displayName });
  const submit = form.handleSubmit(async (v) => {
    try {
      await invite.mutateAsync({ ...v, employeeId: employee.id });
      notify.success(`Invitation created. We'll email ${v.email}.`);
      onClose();
    } catch (err) {
      if (err instanceof StepUpCancelledError) return;
      setFormError(applyServerErrors(form, err, errorMessage));
    }
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Invite ${employee.displayName} to sign in`}
      description="They get an email with a link to sign in. The Employee role comes from this record; add other roles in Settings, Users."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={invite.isPending} onClick={() => void submit()}>
            Send invitation
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <FormField
          control={form.control}
          name="email"
          label="Email"
          render={(p) => <Input type="email" autoComplete="off" {...p} />}
        />
        <FormField control={form.control} name="name" label="Name" render={(p) => <Input {...p} />} />
      </form>
    </Dialog>
  );
}
