import { UpdateCompanyInputSchema } from '@hrm/contracts';
import { Button, Card, Input, KeyValueList, LoadingBlock, notify, Textarea } from '@hrm/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Suspense, useState } from 'react';
import { PageHeader } from '../../../components/page-header';
import { orgQueries, useUpdateCompany } from '../../../features/organization/api';
import { SettingsScopeForm } from '../../../features/settings/settings-form';
import { useErrorMessage } from '../../../lib/api/errors';
import { requireAny, useCan } from '../../../lib/auth/me';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../../lib/forms';

export const Route = createFileRoute('/_app/settings/company')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['settings.read']),
  loader: ({ context }) => context.queryClient.ensureQueryData(orgQueries.company()),
  pendingComponent: () => <LoadingBlock label="company" />,
  component: CompanyPage,
});

function CompanyPage() {
  const { data: company } = useSuspenseQuery(orgQueries.company());
  const canEdit = useCan('settings.hr.manage');
  const canEditTechnical = useCan('settings.technical.manage');
  const save = useUpdateCompany();
  const errorMessage = useErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useZodForm(UpdateCompanyInputSchema, {
    name: company.name,
    legalName: company.legalName,
    email: company.email,
    phone: company.phone,
    address: company.address,
    version: company.version,
  });
  const text = (v: string) => (v === '' ? null : v);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Company" description="Name and contact details shown on payslips and emails." />
      <Card>
        <form
          className="flex flex-col gap-5"
          onSubmit={form.handleSubmit(async (values) => {
            setFormError(null);
            try {
              const updated = await save.mutateAsync(values);
              form.reset({ ...values, version: updated.version });
              notify.success('Company details saved');
            } catch (err) {
              setFormError(applyServerErrors(form, err, errorMessage));
            }
          })}
        >
          <FormError message={formError} />
          <fieldset disabled={!canEdit} className="flex flex-col gap-5">
            <FormField
              control={form.control}
              name="name"
              label="Company name"
              render={(p) => <Input {...p} />}
            />
            <FormField
              control={form.control}
              name="legalName"
              label="Legal name"
              optional
              render={(p) => <Input {...p} onChange={(e) => p.onChange(text(e.target.value))} />}
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="email"
                label="Email"
                optional
                render={(p) => (
                  <Input type="email" {...p} onChange={(e) => p.onChange(text(e.target.value))} />
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                label="Phone"
                optional
                render={(p) => <Input type="tel" {...p} onChange={(e) => p.onChange(text(e.target.value))} />}
              />
            </div>
            <FormField
              control={form.control}
              name="address"
              label="Address"
              optional
              render={(p) => <Textarea {...p} onChange={(e) => p.onChange(text(e.target.value))} />}
            />
          </fieldset>
          {canEdit ? (
            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                loading={save.isPending}
                disabled={!form.formState.isDirty}
              >
                Save changes
              </Button>
            </div>
          ) : null}
        </form>
      </Card>
      <Card>
        <KeyValueList
          items={[
            { label: 'Time zone', value: company.timezone },
            { label: 'Currency', value: company.currency },
          ]}
        />
      </Card>
      <section aria-labelledby="technical-settings" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="technical-settings" className="font-display text-xl font-semibold">
            Technical settings
          </h2>
          <p className="text-text-2">
            {canEditTechnical
              ? 'File uploads and sign-in sessions.'
              : 'File uploads and sign-in sessions. Only a system admin can change these.'}
          </p>
        </div>
        <Suspense fallback={<LoadingBlock label="technical settings" />}>
          <SettingsScopeForm scope="technical" sections={['Files', 'Sessions']} hideFixed />
        </Suspense>
      </section>
    </div>
  );
}
