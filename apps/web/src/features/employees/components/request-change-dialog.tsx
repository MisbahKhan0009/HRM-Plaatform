import {
  CreateProfileChangeRequestInputSchema,
  type EmployeeContact,
  type EmployeeSelf,
  genderValues,
  type ProfileChangeField,
} from '@hrm/contracts';
import { Alert, Button, Dialog, Input, notify, Select, Textarea } from '@hrm/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { useErrorMessage } from '../../../lib/api/errors';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../../lib/forms';
import { useRequestProfileChange } from '../api';
import { contactFields, EmergencyContactFormSchema, employeeFields, omitBlank } from '../forms';
import { displayValue, GENDER_LABEL, PROFILE_FIELD_LABEL } from '../labels';

export type ChangeSection = 'identity' | 'contact' | 'emergency';

export const SECTION_LABEL: Record<ChangeSection, string> = {
  identity: 'Identity',
  contact: 'Contact details',
  emergency: 'Emergency contacts',
};

const SECTION_FIELDS: Record<ChangeSection, ProfileChangeField[]> = {
  identity: ['firstName', 'lastName', 'preferredName', 'dateOfBirth', 'gender'],
  contact: ['personalEmail', 'personalPhone', 'presentAddress', 'permanentAddress', 'nationalIdNumber'],
  emergency: ['emergencyContacts'],
};

// Every allow-listed field (FR-EMP-011) in one form; only the open section's fields are compared and sent.
const RequestForm = z.object({
  firstName: employeeFields.firstName,
  lastName: employeeFields.lastName,
  preferredName: employeeFields.preferredName,
  dateOfBirth: employeeFields.dateOfBirth,
  gender: employeeFields.gender,
  ...contactFields,
  emergencyContacts: z.array(EmergencyContactFormSchema).max(5),
  reason: omitBlank(CreateProfileChangeRequestInputSchema.shape.reason),
});

const norm = (v: unknown) => (v === '' || v === undefined ? null : v);

/**
 * "Request a change" (USER-FLOWS 8): current value beside each new value; only changed fields are sent. The
 * employee comes from the session, never from this form.
 */
export function RequestChangeDialog({
  profile,
  contact,
  initialSection,
  onClose,
}: {
  profile: EmployeeSelf;
  contact: EmployeeContact | null | undefined;
  initialSection: ChangeSection;
  onClose: () => void;
}) {
  const request = useRequestProfileChange();
  const errorMessage = useErrorMessage();
  const [section, setSection] = useState(initialSection);
  const [formError, setFormError] = useState<string | null>(null);
  const current: Record<ProfileChangeField, unknown> = {
    firstName: profile.firstName,
    lastName: profile.lastName,
    preferredName: profile.preferredName,
    dateOfBirth: profile.dateOfBirth,
    gender: profile.gender,
    personalEmail: contact?.personalEmail ?? null,
    personalPhone: contact?.personalPhone ?? null,
    presentAddress: contact?.presentAddress ?? null,
    permanentAddress: contact?.permanentAddress ?? null,
    nationalIdNumber: contact?.nationalIdNumber ?? null,
    emergencyContacts: contact?.emergencyContacts ?? [],
  };
  const form = useZodForm(RequestForm, {
    firstName: profile.firstName,
    lastName: profile.lastName,
    preferredName: profile.preferredName ?? '',
    dateOfBirth: profile.dateOfBirth ?? '',
    gender: profile.gender ?? '',
    personalEmail: contact?.personalEmail ?? '',
    personalPhone: contact?.personalPhone ?? '',
    presentAddress: contact?.presentAddress ?? '',
    permanentAddress: contact?.permanentAddress ?? '',
    nationalIdNumber: contact?.nationalIdNumber ?? '',
    emergencyContacts: contact?.emergencyContacts ?? [],
    reason: '',
  });
  const emergency = useFieldArray({ control: form.control, name: 'emergencyContacts' });

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    const changes: Record<string, unknown> = {};
    for (const f of SECTION_FIELDS[section]) {
      const next = norm(v[f]);
      if (JSON.stringify(next) !== JSON.stringify(norm(current[f]))) changes[f] = next;
    }
    if (!Object.keys(changes).length) {
      setFormError('Change at least one value before you submit.');
      return;
    }
    try {
      await request.mutateAsync({ changes, ...(v.reason ? { reason: v.reason } : {}) });
      notify.success('Request submitted. HR will review it.');
      onClose();
    } catch (err) {
      setFormError(applyServerErrors(form, err, errorMessage));
    }
  });

  const was = (f: ProfileChangeField) => (
    <span className="text-sm text-text-2">Now: {displayValue(f, current[f])}</span>
  );
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title="Request a change"
      description="HR reviews each request. Approved changes appear on your profile straight away."
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
        <div className="flex flex-col gap-1.5">
          <label htmlFor="change-section" className="text-sm font-medium">
            What do you want to change?
          </label>
          <Select
            id="change-section"
            value={section}
            onChange={(e) => {
              setSection(e.target.value as ChangeSection);
              setFormError(null);
            }}
          >
            {(Object.keys(SECTION_LABEL) as ChangeSection[]).map((s) => (
              <option key={s} value={s}>
                {SECTION_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
        {section === 'identity' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {(['firstName', 'lastName', 'preferredName'] as const).map((f) => (
              <FormField
                key={f}
                control={form.control}
                name={f}
                label={PROFILE_FIELD_LABEL[f]}
                optional={f === 'preferredName'}
                hint={was(f)}
                render={(p) => <Input {...p} />}
              />
            ))}
            <FormField
              control={form.control}
              name="dateOfBirth"
              label={PROFILE_FIELD_LABEL.dateOfBirth}
              optional
              hint={was('dateOfBirth')}
              render={(p) => <Input type="date" {...p} />}
            />
            <FormField
              control={form.control}
              name="gender"
              label={PROFILE_FIELD_LABEL.gender}
              optional
              hint={was('gender')}
              render={(p) => (
                <Select {...p} onChange={(e) => p.onChange(e.target.value)}>
                  <option value="">Not recorded</option>
                  {genderValues.map((g) => (
                    <option key={g} value={g}>
                      {GENDER_LABEL[g]}
                    </option>
                  ))}
                </Select>
              )}
            />
          </div>
        ) : null}
        {section === 'contact' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {(['personalEmail', 'personalPhone', 'nationalIdNumber'] as const).map((f) => (
              <FormField
                key={f}
                control={form.control}
                name={f}
                label={PROFILE_FIELD_LABEL[f]}
                optional
                hint={was(f)}
                render={(p) => (
                  <Input
                    {...p}
                    type={f === 'personalEmail' ? 'email' : f === 'personalPhone' ? 'tel' : 'text'}
                  />
                )}
              />
            ))}
            {(['presentAddress', 'permanentAddress'] as const).map((f) => (
              <FormField
                key={f}
                control={form.control}
                name={f}
                label={PROFILE_FIELD_LABEL[f]}
                optional
                hint={was(f)}
                render={(p) => <Textarea {...p} />}
              />
            ))}
          </div>
        ) : null}
        {section === 'emergency' ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">Emergency contacts (up to 5)</legend>
            {emergency.fields.map((f, i) => (
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
                  onClick={() => emergency.remove(i)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ))}
            {emergency.fields.length < 5 ? (
              <Button
                variant="secondary"
                size="sm"
                className="w-fit"
                icon={<Plus aria-hidden="true" />}
                onClick={() => emergency.append({ name: '', relationship: '', phone: '' })}
              >
                Add emergency contact
              </Button>
            ) : null}
            <Alert tone="info">Now: {displayValue('emergencyContacts', current.emergencyContacts)}</Alert>
          </fieldset>
        ) : null}
        <FormField
          control={form.control}
          name="reason"
          label="Reason"
          optional
          hint="For example: name changed after marriage."
          render={(p) => <Textarea {...p} />}
        />
      </form>
    </Dialog>
  );
}
