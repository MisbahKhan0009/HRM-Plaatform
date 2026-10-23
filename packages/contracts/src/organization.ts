import { z } from 'zod';
import { VersionSchema } from './common';
import { IsoDateSchema } from './primitives';

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const TimeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM (24 h)');
const auditFields = { version: z.number().int(), createdAt: z.string(), updatedAt: z.string() };

// Company (FR-ORG-001)
export const CompanySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  legalName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  timezone: z.string(),
  currency: z.string(),
  hasLogo: z.boolean(),
  ...auditFields,
});
export type Company = z.infer<typeof CompanySchema>;

export const UpdateCompanyInputSchema = z
  .object({
    name: trimmed(200).optional(),
    legalName: trimmed(200).nullable().optional(),
    email: z.email().max(254).nullable().optional(),
    phone: trimmed(40).nullable().optional(),
    address: trimmed(500).nullable().optional(),
    version: VersionSchema,
  })
  .strict();
export type UpdateCompanyInput = z.infer<typeof UpdateCompanyInputSchema>;

// Departments (FR-ORG-002)
export const DepartmentSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  headEmployeeId: z.uuid().nullable(),
  headEmployeeName: z.string().nullable(),
  isActive: z.boolean(),
  ...auditFields,
});
export type Department = z.infer<typeof DepartmentSchema>;

export const DepartmentCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{2,20}$/, '2 to 20 letters, digits or dashes');

export const CreateDepartmentInputSchema = z
  .object({ code: DepartmentCodeSchema, name: trimmed(120), headEmployeeId: z.uuid().nullable().optional() })
  .strict();
export type CreateDepartmentInput = z.infer<typeof CreateDepartmentInputSchema>;

export const UpdateDepartmentInputSchema = z
  .object({
    name: trimmed(120).optional(),
    headEmployeeId: z.uuid().nullable().optional(),
    isActive: z.boolean().optional(),
    version: VersionSchema,
  })
  .strict();
export type UpdateDepartmentInput = z.infer<typeof UpdateDepartmentInputSchema>;

// Positions (FR-ORG-003)
export const PositionSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  departmentId: z.uuid().nullable(),
  grade: z.string().nullable(),
  isActive: z.boolean(),
  ...auditFields,
});
export type Position = z.infer<typeof PositionSchema>;

export const CreatePositionInputSchema = z
  .object({
    title: trimmed(120),
    departmentId: z.uuid().nullable().optional(),
    grade: trimmed(40).nullable().optional(),
  })
  .strict();
export type CreatePositionInput = z.infer<typeof CreatePositionInputSchema>;

export const UpdatePositionInputSchema = z
  .object({
    title: trimmed(120).optional(),
    departmentId: z.uuid().nullable().optional(),
    grade: trimmed(40).nullable().optional(),
    isActive: z.boolean().optional(),
    version: VersionSchema,
  })
  .strict();
export type UpdatePositionInput = z.infer<typeof UpdatePositionInputSchema>;

export const ActiveFilterQuerySchema = z
  .object({
    includeInactive: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  })
  .strict();

// Work schedules (D-005, D-010)
const WorkingDaysSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .max(7)
  .refine((d) => new Set(d).size === d.length, 'Days must be unique')
  .describe('0 = Sunday … 6 = Saturday');

export const WorkScheduleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  timezone: z.string(),
  workingDays: z.array(z.number().int()),
  coreStart: z.string(),
  coreEnd: z.string(),
  minDailyMinutes: z.number().int(),
  breakMinutes: z.number().int(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  ...auditFields,
});
export type WorkSchedule = z.infer<typeof WorkScheduleSchema>;

const scheduleFields = {
  name: trimmed(120),
  workingDays: WorkingDaysSchema,
  coreStart: TimeOfDaySchema,
  coreEnd: TimeOfDaySchema,
  minDailyMinutes: z.number().int().min(0).max(1440),
  breakMinutes: z.number().int().min(0).max(480),
  isDefault: z.boolean(),
};

export const CreateWorkScheduleInputSchema = z
  .object({
    ...scheduleFields,
    breakMinutes: scheduleFields.breakMinutes.optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.coreEnd > v.coreStart, {
    message: 'Core end must be after core start',
    path: ['coreEnd'],
  });
export type CreateWorkScheduleInput = z.infer<typeof CreateWorkScheduleInputSchema>;

export const UpdateWorkScheduleInputSchema = z
  .object({
    name: scheduleFields.name.optional(),
    workingDays: scheduleFields.workingDays.optional(),
    coreStart: TimeOfDaySchema.optional(),
    coreEnd: TimeOfDaySchema.optional(),
    minDailyMinutes: scheduleFields.minDailyMinutes.optional(),
    breakMinutes: scheduleFields.breakMinutes.optional(),
    isDefault: z.literal(true).optional(),
    isActive: z.boolean().optional(),
    version: VersionSchema,
  })
  .strict();
export type UpdateWorkScheduleInput = z.infer<typeof UpdateWorkScheduleInputSchema>;

export const ScheduleAssignmentSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  workScheduleId: z.uuid(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  ...auditFields,
});
export type ScheduleAssignment = z.infer<typeof ScheduleAssignmentSchema>;

export const CreateScheduleAssignmentInputSchema = z
  .object({
    employeeId: z.uuid(),
    workScheduleId: z.uuid(),
    effectiveFrom: IsoDateSchema,
    effectiveTo: IsoDateSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, {
    message: 'End before start',
    path: ['effectiveTo'],
  });
export type CreateScheduleAssignmentInput = z.infer<typeof CreateScheduleAssignmentInputSchema>;

// Holidays (FR-ATT: holidays excluded from working days)
export const holidayTypeValues = ['public', 'festival', 'company', 'optional'] as const;
export const HolidaySchema = z.object({
  id: z.uuid(),
  date: z.string(),
  name: z.string(),
  type: z.enum(holidayTypeValues),
  ...auditFields,
});
export type Holiday = z.infer<typeof HolidaySchema>;

export const CreateHolidayInputSchema = z
  .object({ date: IsoDateSchema, name: trimmed(120), type: z.enum(holidayTypeValues).optional() })
  .strict();
export type CreateHolidayInput = z.infer<typeof CreateHolidayInputSchema>;

export const UpdateHolidayInputSchema = z
  .object({
    name: trimmed(120).optional(),
    type: z.enum(holidayTypeValues).optional(),
    version: VersionSchema,
  })
  .strict();
export type UpdateHolidayInput = z.infer<typeof UpdateHolidayInputSchema>;

export const HolidayQuerySchema = z
  .object({ year: z.coerce.number().int().min(2000).max(2100).optional() })
  .strict();
