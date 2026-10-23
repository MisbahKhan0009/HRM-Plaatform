import { z } from 'zod';
import { csvEnum, VersionSchema } from './common';
import { FieldErrorSchema } from './errors';
import { IsoDateSchema, PageQuerySchema } from './primitives';

// Employees module contracts (API-CATALOGUE §4, SECURITY-MODEL §5, DOMAIN-MODEL §4 and §5.2).

export const employeeStatusValues = [
  'draft',
  'preboarding',
  'probation',
  'active',
  'notice_period',
  'separated',
  'archived',
] as const;
export const EmployeeStatusSchema = z.enum(employeeStatusValues);
export type EmployeeStatus = z.infer<typeof EmployeeStatusSchema>;

export const employmentEventTypeValues = [
  'hired',
  'confirmed',
  'promoted',
  'transferred',
  'manager_changed',
  'position_changed',
  'salary_changed',
  'status_changed',
  'separated',
  'rehired',
] as const;
export const EmploymentEventTypeSchema = z.enum(employmentEventTypeValues);
export type EmploymentEventType = z.infer<typeof EmploymentEventTypeSchema>;

export const employmentEventStatusValues = ['scheduled', 'applied', 'cancelled'] as const;

export const contractTypeValues = ['permanent', 'probation', 'fixed_term', 'intern', 'consultant'] as const;
export const ContractTypeSchema = z.enum(contractTypeValues);
export type ContractType = z.infer<typeof ContractTypeSchema>;

export const contractStatusValues = ['draft', 'active', 'expired', 'terminated', 'superseded'] as const;

export const genderValues = ['female', 'male', 'other', 'undisclosed'] as const;
export const separationTypeValues = [
  'resignation',
  'termination',
  'contract_end',
  'retirement',
  'death',
  'other',
] as const;

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const auditFields = { version: z.number().int(), createdAt: z.string(), updatedAt: z.string() };
const NamedRefSchema = z.object({ id: z.uuid(), name: z.string() });
const PositionRefSchema = z.object({ id: z.uuid(), title: z.string() });

// Employee DTOs (SECURITY-MODEL §5): built per permission, never from the row; salary is never included.

const basicFields = {
  id: z.uuid(),
  employeeCode: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  preferredName: z.string().nullable(),
  displayName: z.string(),
  workEmail: z.string().nullable(),
  workPhone: z.string().nullable(),
  status: EmployeeStatusSchema,
  department: NamedRefSchema.nullable(),
  position: PositionRefSchema.nullable(),
  manager: NamedRefSchema.nullable(),
  joiningDate: z.string().nullable(),
  ...auditFields,
};

/** Directory and employment data: what a manager sees for a report (`employee.read.team`). */
export const EmployeeBasicSchema = z.object({ view: z.literal('basic'), ...basicFields });
export type EmployeeBasic = z.infer<typeof EmployeeBasicSchema>;

/** The caller's own record (`employee.read.own`). */
export const EmployeeSelfSchema = z.object({
  view: z.literal('self'),
  ...basicFields,
  dateOfBirth: z.string().nullable(),
  gender: z.enum(genderValues).nullable(),
  probationEndDate: z.string().nullable(),
  separationDate: z.string().nullable(),
});
export type EmployeeSelf = z.infer<typeof EmployeeSelfSchema>;

/** Everything except restricted contact data and salary (`employee.read.all`). */
export const EmployeeFullSchema = z.object({
  view: z.literal('full'),
  ...basicFields,
  dateOfBirth: z.string().nullable(),
  gender: z.enum(genderValues).nullable(),
  probationEndDate: z.string().nullable(),
  separationDate: z.string().nullable(),
  separationType: z.enum(separationTypeValues).nullable(),
  archivedAt: z.string().nullable(),
  /** Linked login account, if any (FR-AUTH-009: an employee may have no login). */
  account: z
    .object({ userId: z.uuid(), status: z.enum(['invited', 'active', 'suspended', 'deactivated']) })
    .nullable(),
});
export type EmployeeFull = z.infer<typeof EmployeeFullSchema>;

export const EmployeeDetailSchema = z.discriminatedUnion('view', [
  EmployeeFullSchema,
  EmployeeBasicSchema,
  EmployeeSelfSchema,
]);
export type EmployeeDetail = z.infer<typeof EmployeeDetailSchema>;

/** Sort parameter `sort=lastName,-joiningDate` against an allow-list (API-STANDARDS §6). */
const sortParam = <const T extends readonly [string, ...string[]]>(fields: T) =>
  z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(
      z
        .array(z.string().regex(new RegExp(`^-?(${fields.join('|')})$`), `Sort by ${fields.join(', ')}`))
        .min(1)
        .max(3),
    )
    .transform((items) =>
      items.map((i) => ({
        field: i.replace(/^-/, '') as T[number],
        direction: i.startsWith('-') ? ('desc' as const) : ('asc' as const),
      })),
    );

export const employeeSortFields = ['employeeCode', 'lastName', 'joiningDate'] as const;
export type EmployeeSortField = (typeof employeeSortFields)[number];

export const EmployeeListQuerySchema = PageQuerySchema.extend({
  status: csvEnum(employeeStatusValues).optional(),
  departmentId: z.uuid().optional(),
  positionId: z.uuid().optional(),
  managerId: z.uuid().optional(),
  q: z.string().trim().min(2).max(100).optional(),
  sort: sortParam(employeeSortFields).optional(),
}).strict();
export type EmployeeListQuery = z.infer<typeof EmployeeListQuerySchema>;

const employeeFields = {
  firstName: trimmed(100),
  lastName: trimmed(100),
  preferredName: trimmed(100).nullable(),
  workEmail: z.email().max(254).nullable(),
  workPhone: trimmed(40).nullable(),
  dateOfBirth: IsoDateSchema.nullable(),
  gender: z.enum(genderValues).nullable(),
  departmentId: z.uuid().nullable(),
  positionId: z.uuid().nullable(),
  managerId: z.uuid().nullable(),
  joiningDate: IsoDateSchema.nullable(),
  probationEndDate: IsoDateSchema.nullable(),
};

/** Fields the `employees.required_fields` setting may require (BUSINESS-RULES §9). */
export type EmployeeRequirableField =
  | 'firstName'
  | 'lastName'
  | 'joiningDate'
  | 'departmentId'
  | 'positionId'
  | 'workEmail'
  | 'managerId';

export const CreateEmployeeInputSchema = z
  .object({
    firstName: employeeFields.firstName,
    lastName: employeeFields.lastName,
    preferredName: employeeFields.preferredName.optional(),
    workEmail: employeeFields.workEmail.optional(),
    workPhone: employeeFields.workPhone.optional(),
    dateOfBirth: employeeFields.dateOfBirth.optional(),
    gender: employeeFields.gender.optional(),
    departmentId: employeeFields.departmentId.optional(),
    positionId: employeeFields.positionId.optional(),
    managerId: employeeFields.managerId.optional(),
    joiningDate: employeeFields.joiningDate.optional(),
    probationEndDate: employeeFields.probationEndDate.optional(),
  })
  .strict();
export type CreateEmployeeInput = z.infer<typeof CreateEmployeeInputSchema>;

/** Non-lifecycle fields only: status, separation and archive go through action endpoints (API-STANDARDS §2). */
export const UpdateEmployeeInputSchema = z
  .object({
    firstName: employeeFields.firstName.optional(),
    lastName: employeeFields.lastName.optional(),
    preferredName: employeeFields.preferredName.optional(),
    workEmail: employeeFields.workEmail.optional(),
    workPhone: employeeFields.workPhone.optional(),
    dateOfBirth: employeeFields.dateOfBirth.optional(),
    gender: employeeFields.gender.optional(),
    departmentId: employeeFields.departmentId.optional(),
    positionId: employeeFields.positionId.optional(),
    managerId: employeeFields.managerId.optional(),
    joiningDate: employeeFields.joiningDate.optional(),
    probationEndDate: employeeFields.probationEndDate.optional(),
    version: VersionSchema,
  })
  .strict();
export type UpdateEmployeeInput = z.infer<typeof UpdateEmployeeInputSchema>;

// Restricted contact data (SECURITY-MODEL §5): `employee.contact.read.all` or own.

export const EmergencyContactSchema = z
  .object({ name: trimmed(120), relationship: trimmed(60), phone: trimmed(40) })
  .strict();

export const EmployeeContactSchema = z.object({
  employeeId: z.uuid(),
  personalEmail: z.string().nullable(),
  personalPhone: z.string().nullable(),
  presentAddress: z.string().nullable(),
  permanentAddress: z.string().nullable(),
  nationalIdNumber: z.string().nullable(),
  emergencyContacts: z.array(EmergencyContactSchema),
  /** 0 when no contact record exists yet; send it back to create one. */
  version: z.number().int(),
  updatedAt: z.string().nullable(),
});
export type EmployeeContact = z.infer<typeof EmployeeContactSchema>;

const contactFields = {
  personalEmail: z.email().max(254).nullable(),
  personalPhone: trimmed(40).nullable(),
  presentAddress: trimmed(500).nullable(),
  permanentAddress: trimmed(500).nullable(),
  nationalIdNumber: trimmed(40).nullable(),
  emergencyContacts: z.array(EmergencyContactSchema).max(5),
};

export const UpdateEmployeeContactInputSchema = z
  .object({
    personalEmail: contactFields.personalEmail.optional(),
    personalPhone: contactFields.personalPhone.optional(),
    presentAddress: contactFields.presentAddress.optional(),
    permanentAddress: contactFields.permanentAddress.optional(),
    nationalIdNumber: contactFields.nationalIdNumber.optional(),
    emergencyContacts: contactFields.emergencyContacts.optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateEmployeeContactInput = z.infer<typeof UpdateEmployeeContactInputSchema>;

// Employment events (FR-EMP-005): effective-dated; a future date is `scheduled` and applied by the daily job.

export const EmploymentEventSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  type: EmploymentEventTypeSchema,
  effectiveDate: z.string(),
  status: z.enum(employmentEventStatusValues),
  changes: z.record(z.string(), z.object({ from: z.unknown(), to: z.unknown() })),
  reason: z.string().nullable(),
  appliedAt: z.string().nullable(),
  createdAt: z.string(),
  createdBy: NamedRefSchema.nullable(),
});
export type EmploymentEvent = z.infer<typeof EmploymentEventSchema>;

export const manualEventTypeValues = [
  'promoted',
  'transferred',
  'manager_changed',
  'position_changed',
] as const;

/** Promotion, transfer, manager or position change. Lifecycle events come from the action endpoints. */
export const CreateEmploymentEventInputSchema = z
  .object({
    type: z.enum(manualEventTypeValues),
    effectiveDate: IsoDateSchema,
    departmentId: z.uuid().nullable().optional(),
    positionId: z.uuid().nullable().optional(),
    managerId: z.uuid().nullable().optional(),
    reason: trimmed(500).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const required = {
      promoted: 'positionId',
      transferred: 'departmentId',
      manager_changed: 'managerId',
      position_changed: 'positionId',
    } as const;
    const key = required[v.type];
    if (v[key] === undefined)
      ctx.addIssue({ code: 'custom', path: [key], message: `Required for a ${v.type} event` });
  });
export type CreateEmploymentEventInput = z.infer<typeof CreateEmploymentEventInputSchema>;

export const HistoryQuerySchema = PageQuerySchema.strict();

// Lifecycle actions (DOMAIN-MODEL §5.2). Every action carries the version the client read (API-STANDARDS §8).

export const VersionOnlyInputSchema = z.object({ version: VersionSchema }).strict();
export type VersionOnlyInput = z.infer<typeof VersionOnlyInputSchema>;

export const EffectiveActionInputSchema = z
  .object({ effectiveDate: IsoDateSchema, reason: trimmed(500).optional(), version: VersionSchema })
  .strict();
export type EffectiveActionInput = z.infer<typeof EffectiveActionInputSchema>;

/** Hire on `effectiveDate`: with `probationEndDate` the employee starts in `probation`, otherwise `active`. */
export const HireEmployeeInputSchema = z
  .object({
    effectiveDate: IsoDateSchema,
    probationEndDate: IsoDateSchema.optional(),
    reason: trimmed(500).optional(),
    version: VersionSchema,
  })
  .strict()
  .refine((v) => !v.probationEndDate || v.probationEndDate > v.effectiveDate, {
    message: 'Probation must end after the hire date',
    path: ['probationEndDate'],
  });
export type HireEmployeeInput = z.infer<typeof HireEmployeeInputSchema>;

/** `separationDate` is the last employed day, inclusive (BUSINESS-RULES §6.2); the status changes on it. */
export const SeparateEmployeeInputSchema = z
  .object({
    separationDate: IsoDateSchema,
    separationType: z.enum(separationTypeValues),
    reason: trimmed(500).optional(),
    version: VersionSchema,
  })
  .strict();
export type SeparateEmployeeInput = z.infer<typeof SeparateEmployeeInputSchema>;

// Contracts (FR-DOC-009)

export const EmploymentContractSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  type: ContractTypeSchema,
  startDate: z.string(),
  endDate: z.string().nullable(),
  status: z.enum(contractStatusValues),
  documentId: z.uuid().nullable(),
  notes: z.string().nullable(),
  ...auditFields,
});
export type EmploymentContract = z.infer<typeof EmploymentContractSchema>;

export const CreateEmploymentContractInputSchema = z
  .object({
    type: ContractTypeSchema,
    startDate: IsoDateSchema,
    endDate: IsoDateSchema.nullable().optional(),
    status: z.enum(contractStatusValues).optional(),
    documentId: z.uuid().nullable().optional(),
    notes: trimmed(1000).nullable().optional(),
  })
  .strict()
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { message: 'End before start', path: ['endDate'] })
  .refine((v) => v.type !== 'fixed_term' || Boolean(v.endDate), {
    message: 'A fixed-term contract needs an end date',
    path: ['endDate'],
  });
export type CreateEmploymentContractInput = z.infer<typeof CreateEmploymentContractInputSchema>;

export const UpdateEmploymentContractInputSchema = z
  .object({
    type: ContractTypeSchema.optional(),
    startDate: IsoDateSchema.optional(),
    endDate: IsoDateSchema.nullable().optional(),
    status: z.enum(contractStatusValues).optional(),
    documentId: z.uuid().nullable().optional(),
    notes: trimmed(1000).nullable().optional(),
    version: VersionSchema,
  })
  .strict();
export type UpdateEmploymentContractInput = z.infer<typeof UpdateEmploymentContractInputSchema>;

export const ContractParamSchema = z.object({ id: z.uuid(), contractId: z.uuid() });

// CSV import (FR-EMP-008): stateless preview; commit re-sends the CSV with the preview token.

export const importFieldValues = [
  'employeeCode',
  'firstName',
  'lastName',
  'preferredName',
  'workEmail',
  'workPhone',
  'dateOfBirth',
  'gender',
  'departmentCode',
  'positionTitle',
  'managerCode',
  'joiningDate',
  'probationEndDate',
] as const;
export const ImportFieldSchema = z.enum(importFieldValues);
export type ImportField = z.infer<typeof ImportFieldSchema>;

export const IMPORT_MAX_ROWS = 500;
/** 500 rows of about 300 characters: keeps parsing well inside the Worker CPU budget (ADR-0009). */
export const IMPORT_MAX_CSV_CHARS = 200_000;

/** Column header → field (or null to ignore the column). Omitted: headers are matched to field names. */
const ImportMappingSchema = z
  .record(z.string().max(100), ImportFieldSchema.nullable())
  .refine((m) => Object.keys(m).length <= 50, 'At most 50 columns');

export const EmployeeImportPreviewInputSchema = z
  .object({ csv: z.string().min(1).max(IMPORT_MAX_CSV_CHARS), mapping: ImportMappingSchema.optional() })
  .strict();
export type EmployeeImportPreviewInput = z.infer<typeof EmployeeImportPreviewInputSchema>;

export const EmployeeImportCommitInputSchema = z
  .object({
    csv: z.string().min(1).max(IMPORT_MAX_CSV_CHARS),
    mapping: ImportMappingSchema.optional(),
    previewToken: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type EmployeeImportCommitInput = z.infer<typeof EmployeeImportCommitInputSchema>;

/** One error of one CSV row; `row` is the 1-based data row (the header is row 0). */
export const ImportRowErrorSchema = z.object({ row: z.number().int() }).extend(FieldErrorSchema.shape);
export type ImportRowError = z.infer<typeof ImportRowErrorSchema>;

export const EmployeeImportPreviewSchema = z.object({
  /** SHA-256 of the CSV text; send it with the same CSV to commit. */
  previewToken: z.string(),
  mapping: z.record(z.string(), ImportFieldSchema.nullable()),
  totalRows: z.number().int(),
  validRows: z.number().int(),
  invalidRows: z.number().int(),
  rows: z.array(
    z.object({
      row: z.number().int(),
      valid: z.boolean(),
      employeeCode: z.string().nullable(),
      name: z.string(),
    }),
  ),
  /** Rows whose work email or employee code repeats another row or an existing employee. */
  duplicates: z.array(z.number().int()),
  errors: z.array(ImportRowErrorSchema),
});
export type EmployeeImportPreview = z.infer<typeof EmployeeImportPreviewSchema>;

export const EmployeeImportResultSchema = z.object({
  createdCount: z.number().int(),
  skippedCount: z.number().int(),
  /** Each created employee with its status after import: `active`, or `probation` while probation runs. */
  created: z.array(
    z.object({
      row: z.number().int(),
      id: z.uuid(),
      employeeCode: z.string(),
      status: EmployeeStatusSchema,
    }),
  ),
  errors: z.array(ImportRowErrorSchema),
});
export type EmployeeImportResult = z.infer<typeof EmployeeImportResultSchema>;

// Profile change requests (FR-EMP-011, US-EMP-008): allow-listed fields only.

export const profileChangeFieldValues = [
  'firstName',
  'lastName',
  'preferredName',
  'dateOfBirth',
  'gender',
  'personalEmail',
  'personalPhone',
  'presentAddress',
  'permanentAddress',
  'nationalIdNumber',
  'emergencyContacts',
] as const;
export type ProfileChangeField = (typeof profileChangeFieldValues)[number];

export const profileChangeStatusValues = ['pending', 'approved', 'rejected', 'withdrawn'] as const;

export const ProfileChangesSchema = z
  .object({
    firstName: employeeFields.firstName.optional(),
    lastName: employeeFields.lastName.optional(),
    preferredName: employeeFields.preferredName.optional(),
    dateOfBirth: employeeFields.dateOfBirth.optional(),
    gender: employeeFields.gender.optional(),
    personalEmail: contactFields.personalEmail.optional(),
    personalPhone: contactFields.personalPhone.optional(),
    presentAddress: contactFields.presentAddress.optional(),
    permanentAddress: contactFields.permanentAddress.optional(),
    nationalIdNumber: contactFields.nationalIdNumber.optional(),
    emergencyContacts: contactFields.emergencyContacts.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Request at least one change');

export const CreateProfileChangeRequestInputSchema = z
  .object({ changes: ProfileChangesSchema, reason: trimmed(500).optional() })
  .strict();
export type CreateProfileChangeRequestInput = z.infer<typeof CreateProfileChangeRequestInputSchema>;

export const ProfileChangeRequestSchema = z.object({
  id: z.uuid(),
  employee: NamedRefSchema.extend({ employeeCode: z.string() }),
  status: z.enum(profileChangeStatusValues),
  changes: z.record(z.string(), z.object({ from: z.unknown(), to: z.unknown() })),
  reason: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionComment: z.string().nullable(),
  ...auditFields,
});
export type ProfileChangeRequest = z.infer<typeof ProfileChangeRequestSchema>;

export const ProfileChangeListQuerySchema = PageQuerySchema.extend({
  status: csvEnum(profileChangeStatusValues).optional(),
  employeeId: z.uuid().optional(),
}).strict();
export type ProfileChangeListQuery = z.infer<typeof ProfileChangeListQuerySchema>;
