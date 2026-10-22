import { Button, Card, CardHeader, Checkbox, notify } from '@hrm/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { PageHeader } from '../../../components/page-header';
import { useErrorMessage } from '../../../lib/api/errors';
import { useCan } from '../../../lib/auth/me';
import { applyServerErrors, FormError, useZodForm } from '../../../lib/forms';
import { useCreateEmployee, useInviteEmployee, useLifecycleAction } from '../api';
import { EmployeeFormFields } from '../components/employee-form-fields';
import { employeeFormDefaults, employeeFormSchema } from '../forms';
import { useRequiredEmployeeFields } from '../hooks';

// SCREEN-INVENTORY §8.2, canvas EmployeeNew: identity, employment and work contact; salary is added by payroll.
export function NewEmployeePage() {
  const navigate = useNavigate();
  const required = useRequiredEmployeeFields();
  const schema = useMemo(() => employeeFormSchema(required), [required]);
  const form = useZodForm(schema, employeeFormDefaults());
  const create = useCreateEmployee();
  const canInvite = useCan('user.manage');
  const errorMessage = useErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const [startPreboarding, setStartPreboarding] = useState(false);
  const [invite, setInvite] = useState(canInvite);
  const lifecycle = useLifecycleAction();
  const inviteUser = useInviteEmployee();

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    let created: Awaited<ReturnType<typeof create.mutateAsync>>;
    try {
      created = await create.mutateAsync(values);
    } catch (err) {
      setFormError(applyServerErrors(form, err, errorMessage));
      return;
    }
    notify.success(`${created.displayName} added as ${created.employeeCode}`);
    // Follow-ups are best effort: the record exists, so a failure here is reported, not rolled back.
    if (startPreboarding) {
      try {
        await lifecycle.mutateAsync({
          id: created.id,
          action: 'start-preboarding',
          input: { version: created.version },
        });
      } catch (err) {
        notify.error(`Preboarding not started: ${errorMessage(err)}`);
      }
    }
    if (invite && canInvite && created.workEmail) {
      try {
        await inviteUser.mutateAsync({
          email: created.workEmail,
          name: created.displayName,
          employeeId: created.id,
        });
        notify.success(`Invitation created. We'll email ${created.workEmail}.`);
      } catch (err) {
        notify.error(`Invitation not sent: ${errorMessage(err)}`);
      }
    }
    void navigate({ to: '/employees/$employeeId', params: { employeeId: created.id } });
  });

  const busy = create.isPending || lifecycle.isPending || inviteUser.isPending;
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="New employee"
        breadcrumb={{ label: 'Employees', to: '/employees' }}
        description="Collect only what the company needs. Salary is added separately by payroll."
      />
      <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
        <FormError message={formError} />
        <Card aria-labelledby="s-identity">
          <CardHeader id="s-identity" label="Step 1" title="Identity" />
          <EmployeeFormFields control={form.control} section="identity" required={required} />
        </Card>
        <Card aria-labelledby="s-employment">
          <CardHeader id="s-employment" label="Step 2" title="Employment" />
          <div className="flex flex-col gap-4">
            <EmployeeFormFields control={form.control} section="employment" required={required} />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Starting status</legend>
              <label className="inline-flex items-center gap-2 text-[15px]">
                <input
                  type="radio"
                  name="startingStatus"
                  className="size-4 accent-[var(--action)]"
                  checked={!startPreboarding}
                  onChange={() => setStartPreboarding(false)}
                />
                Draft: still being prepared
              </label>
              <label className="inline-flex items-center gap-2 text-[15px]">
                <input
                  type="radio"
                  name="startingStatus"
                  className="size-4 accent-[var(--action)]"
                  checked={startPreboarding}
                  onChange={() => setStartPreboarding(true)}
                />
                Preboarding: an offer is accepted and they're getting ready to join
              </label>
            </fieldset>
          </div>
        </Card>
        <Card aria-labelledby="s-contact">
          <CardHeader id="s-contact" label="Step 3" title="Work contact" />
          <div className="flex flex-col gap-4">
            <EmployeeFormFields control={form.control} section="work-contact" required={required} />
            {canInvite ? (
              <div className="flex flex-col gap-1">
                <Checkbox
                  label="Invite them to sign in"
                  checked={invite}
                  onChange={(e) => setInvite(e.target.checked)}
                />
                <p className="pl-6 text-sm text-text-2">
                  An invitation email goes to the work email after you create the record.
                </p>
              </div>
            ) : null}
          </div>
        </Card>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" asChild>
            <Link to="/employees">Cancel</Link>
          </Button>
          <Button variant="primary" type="submit" loading={busy}>
            Create employee
          </Button>
        </div>
      </form>
    </div>
  );
}
