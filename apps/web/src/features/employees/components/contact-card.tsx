import { type EmployeeContact, UpdateEmployeeContactInputSchema } from '@hrm/contracts';
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  Input,
  KeyValueList,
  LoadingBlock,
  notify,
  Textarea,
} from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { useErrorMessage } from '../../../lib/api/errors';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../../lib/forms';
import { employeeQueries, useUpdateContact } from '../api';
import { contactFields, EmergencyContactFormSchema } from '../forms';

/**
 * Restricted contact data (SECURITY-MODEL §5): HR with `employee.contact.read.all`, or the employee themself. Reads
 * are audited by the API, so this loads only when the card is shown.
 */
export function ContactCard({
  employeeId,
  canEdit,
  action,
}: {
  employeeId: string;
  canEdit: boolean;
  /** Extra header action (for example "Request a change" on /me). */
  action?: ReactNode;
}) {
  const contact = useQuery(employeeQueries.contact(employeeId));
  const errorMessage = useErrorMessage();
  const [editing, setEditing] = useState(false);
  return (
    <Card aria-labelledby="h-contact">
      <CardHeader
        id="h-contact"
        label={
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3" aria-hidden="true" />
            Restricted
          </span>
        }
        title="Personal contact"
        actions={
          <>
            {action}
            {canEdit && contact.data ? (
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                Edit contact
              </Button>
            ) : null}
          </>
        }
      />
      {contact.isPending ? (
        <LoadingBlock label="contact details" rows={3} />
      ) : contact.isError ? (
        <p className="text-bad">{errorMessage(contact.error)}</p>
      ) : (
        <div className="flex flex-col gap-6">
          <KeyValueList
            items={[
              { label: 'Personal email', value: contact.data.personalEmail ?? '—' },
              { label: 'Personal phone', value: contact.data.personalPhone ?? '—' },
              { label: 'Present address', value: contact.data.presentAddress ?? '—' },
              { label: 'Permanent address', value: contact.data.permanentAddress ?? '—' },
              {
                label: 'National ID',
                value: contact.data.nationalIdNumber ? (
                  <span className="font-mono">{contact.data.nationalIdNumber}</span>
                ) : (
                  '—'
                ),
              },
            ]}
          />
          <div className="flex flex-col gap-2">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.13em] text-text-3">
              Emergency contacts
            </h3>
            {contact.data.emergencyContacts.length ? (
              <ul className="flex flex-col divide-y divide-line">
                {contact.data.emergencyContacts.map((c) => (
                  <li key={`${c.name}-${c.phone}`} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>
                      {c.name} <span className="text-text-2">({c.relationship})</span>
                    </span>
                    <span className="font-mono text-sm">{c.phone}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-text-2">No emergency contact recorded.</p>
            )}
          </div>
        </div>
      )}
      {editing && contact.data ? (
        <ContactDialog employeeId={employeeId} contact={contact.data} onClose={() => setEditing(false)} />
      ) : null}
    </Card>
  );
}

const ContactForm = z.object({
  ...contactFields,
  emergencyContacts: z.array(EmergencyContactFormSchema).max(5),
  version: UpdateEmployeeContactInputSchema.shape.version,
});

function ContactDialog({
  employeeId,
  contact,
  onClose,
}: {
  employeeId: string;
  contact: EmployeeContact;
  onClose: () => void;
}) {
  const save = useUpdateContact(employeeId);
  const errorMessage = useErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useZodForm(ContactForm, {
    personalEmail: contact.personalEmail ?? '',
    personalPhone: contact.personalPhone ?? '',
    presentAddress: contact.presentAddress ?? '',
    permanentAddress: contact.permanentAddress ?? '',
    nationalIdNumber: contact.nationalIdNumber ?? '',
    emergencyContacts: contact.emergencyContacts,
    version: contact.version,
  });
  const contacts = useFieldArray({ control: form.control, name: 'emergencyContacts' });
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync(v);
      notify.success('Contact details saved');
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
      title="Edit contact details"
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
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="personalEmail"
            label="Personal email"
            optional
            render={(p) => <Input type="email" {...p} />}
          />
          <FormField
            control={form.control}
            name="personalPhone"
            label="Personal phone"
            optional
            render={(p) => <Input type="tel" {...p} />}
          />
          <FormField
            control={form.control}
            name="presentAddress"
            label="Present address"
            optional
            render={(p) => <Textarea {...p} />}
          />
          <FormField
            control={form.control}
            name="permanentAddress"
            label="Permanent address"
            optional
            render={(p) => <Textarea {...p} />}
          />
          <FormField
            control={form.control}
            name="nationalIdNumber"
            label="National ID number"
            optional
            render={(p) => <Input {...p} className="font-mono" />}
          />
        </div>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">Emergency contacts (up to 5)</legend>
          {contacts.fields.map((f, i) => (
            <div key={f.id} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <FormField
                control={form.control}
                name={`emergencyContacts.${i}.name`}
                label="Name"
                render={(p) => <Input {...p} />}
              />
              <FormField
                control={form.control}
                name={`emergencyContacts.${i}.relationship`}
                label="Relationship"
                render={(p) => <Input {...p} />}
              />
              <FormField
                control={form.control}
                name={`emergencyContacts.${i}.phone`}
                label="Phone"
                render={(p) => <Input type="tel" {...p} />}
              />
              <Button
                variant="icon"
                size="icon"
                aria-label={`Remove emergency contact ${i + 1}`}
                onClick={() => contacts.remove(i)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
          {contacts.fields.length < 5 ? (
            <Button
              variant="secondary"
              size="sm"
              className="w-fit"
              icon={<Plus aria-hidden="true" />}
              onClick={() => contacts.append({ name: '', relationship: '', phone: '' })}
            >
              Add emergency contact
            </Button>
          ) : null}
        </fieldset>
      </form>
    </Dialog>
  );
}
