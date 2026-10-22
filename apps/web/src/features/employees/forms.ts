import {
  CreateEmployeeInputSchema,
  EmergencyContactSchema,
  type EmployeeFull,
  type EmployeeRequirableField,
  SETTINGS,
  UpdateEmployeeContactInputSchema,
} from '@hrm/contracts';
import { z } from 'zod';

// Form schemas built from the contract fields (FORMS-AND-VALIDATION §1). Text inputs hold '' for "no value", which
// the contract spells null, so optional fields map '' to null before the contract schema runs.

/** '' (an empty input or select) → null, then the contract's own rule. */
export const blank = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), schema);

/** '' → undefined, for optional fields the contract does not allow as null (reasons, notes on actions). */
export const omitBlank = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema);

/** A required text field: "Required." for an empty value, then the contract's own rule. */
export const filled = <T extends z.ZodType<unknown, string>>(schema: T) =>
  z.string().trim().min(1, 'Required.').pipe(schema);

/** An emergency contact row with plain-language messages; the contract schema still decides. */
export const EmergencyContactFormSchema = z.object({
  name: filled(EmergencyContactSchema.shape.name),
  relationship: filled(EmergencyContactSchema.shape.relationship),
  phone: filled(EmergencyContactSchema.shape.phone),
});

const E = CreateEmployeeInputSchema.shape;

export const employeeFields = {
  firstName: filled(E.firstName),
  lastName: filled(E.lastName),
  preferredName: blank(E.preferredName),
  workEmail: blank(E.workEmail),
  workPhone: blank(E.workPhone),
  dateOfBirth: blank(E.dateOfBirth),
  gender: blank(E.gender),
  departmentId: blank(E.departmentId),
  positionId: blank(E.positionId),
  managerId: blank(E.managerId),
  joiningDate: blank(E.joiningDate),
  probationEndDate: blank(E.probationEndDate),
};

export const DEFAULT_REQUIRED_FIELDS: readonly EmployeeRequirableField[] =
  SETTINGS['employees.required_fields'].default;

const employeeObject = z.object(employeeFields);
export type EmployeeFormInput = z.input<typeof employeeObject>;
export type EmployeeFormOutput = z.output<typeof employeeObject>;

/**
 * `employees.required_fields` (BUSINESS-RULES §9) checked in the browser too, so the form flags them on blur. The
 * edit dialog uses the same schema and adds the version it read when it submits.
 */
export function employeeFormSchema(required: readonly string[]) {
  return employeeObject.superRefine((v, ctx) => {
    for (const field of required) {
      const value = v[field as keyof typeof v];
      if (value === null || value === undefined)
        ctx.addIssue({ code: 'custom', path: [field], message: 'Required.' });
    }
  });
}

export const employeeFormDefaults = (e?: EmployeeFull | null) => ({
  firstName: e?.firstName ?? '',
  lastName: e?.lastName ?? '',
  preferredName: e?.preferredName ?? '',
  workEmail: e?.workEmail ?? '',
  workPhone: e?.workPhone ?? '',
  dateOfBirth: e?.dateOfBirth ?? '',
  gender: e?.gender ?? '',
  departmentId: e?.department?.id ?? '',
  positionId: e?.position?.id ?? '',
  managerId: e?.manager?.id ?? '',
  joiningDate: e?.joiningDate ?? '',
  probationEndDate: e?.probationEndDate ?? '',
});

const C = UpdateEmployeeContactInputSchema.shape;

export const contactFields = {
  personalEmail: blank(C.personalEmail),
  personalPhone: blank(C.personalPhone),
  presentAddress: blank(C.presentAddress),
  permanentAddress: blank(C.permanentAddress),
  nationalIdNumber: blank(C.nationalIdNumber),
};
