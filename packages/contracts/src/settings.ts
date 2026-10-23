import { z } from 'zod';
import { MoneyAmountSchema } from './primitives';

export const settingScopeValues = ['technical', 'hr', 'payroll'] as const;
export type SettingScope = (typeof settingScopeValues)[number];

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const retention = z.number().int().min(1).max(36500).nullable();

/** Settings catalogue: key, scope, value schema and seed default (BUSINESS-RULES §9, D-042). */
export const SETTINGS = {
  'company.timezone': { scope: 'technical', schema: z.literal('Asia/Dhaka'), default: 'Asia/Dhaka' },
  'company.currency': { scope: 'payroll', schema: z.literal('BDT'), default: 'BDT' },
  'company.locale_default': { scope: 'hr', schema: z.enum(['en', 'bn']), default: 'en' },
  'employees.code_prefix': { scope: 'hr', schema: z.string().regex(/^[A-Z]{1,6}-?$/), default: 'EMP-' },
  'employees.code_padding': { scope: 'hr', schema: int(3, 8), default: 4 },
  'employees.required_fields': {
    scope: 'hr',
    schema: z.array(
      z.enum([
        'firstName',
        'lastName',
        'joiningDate',
        'departmentId',
        'positionId',
        'workEmail',
        'managerId',
      ]),
    ),
    default: ['firstName', 'lastName', 'joiningDate', 'departmentId', 'positionId'],
  },
  'attendance.checkout_window_hours': { scope: 'hr', schema: int(1, 24), default: 16 },
  'attendance.correction_window_days': { scope: 'hr', schema: int(1, 90), default: 7 },
  'leave.calendar.visible_to_team': { scope: 'hr', schema: z.boolean(), default: false },
  'approvals.hide_reviewer': { scope: 'hr', schema: z.boolean(), default: false },
  'payroll.anomaly_threshold_percent': { scope: 'payroll', schema: int(1, 100), default: 20 },
  'payroll.allow_self_approval': { scope: 'payroll', schema: z.boolean(), default: true },
  'payroll.midperiod_salary_change_policy': {
    scope: 'payroll',
    schema: z.literal('segment_proration').nullable(),
    default: 'segment_proration',
  },
  'reimbursements.review_threshold': { scope: 'payroll', schema: MoneyAmountSchema, default: '5000.00' },
  'reimbursements.max_claim_age_days': { scope: 'payroll', schema: int(1, 365), default: 60 },
  'documents.max_upload_mb': { scope: 'technical', schema: int(1, 10), default: 10 },
  'documents.retention_days.identity': { scope: 'hr', schema: retention, default: null },
  'documents.retention_days.contract': { scope: 'hr', schema: retention, default: null },
  'documents.retention_days.certificate': { scope: 'hr', schema: retention, default: null },
  'documents.retention_days.payslip': { scope: 'hr', schema: retention, default: null },
  'documents.retention_days.receipt': { scope: 'hr', schema: retention, default: null },
  'documents.retention_days.policy': { scope: 'hr', schema: retention, default: null },
  'documents.retention_days.other': { scope: 'hr', schema: retention, default: null },
  'security.session_idle_hours': { scope: 'technical', schema: int(1, 24), default: 8 },
  'security.privileged_idle_hours': { scope: 'technical', schema: int(1, 8), default: 1 },
} as const satisfies Record<string, SettingDef<unknown>>;

interface SettingDef<T> {
  scope: SettingScope;
  schema: z.ZodType<T>;
  default: T;
}

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export const SettingDtoSchema = z.object({
  key: z.string(),
  scope: z.enum(settingScopeValues),
  value: z.unknown(),
  /** Seed default from the catalogue, so the UI can show "changed from default". */
  defaultValue: z.unknown(),
  /** Per-key optimistic lock (API-STANDARDS §8); 0 when the key has never been stored. */
  version: z.number().int(),
  updatedAt: z.string().nullable(),
  /** The caller holds `settings.<scope>.manage`. */
  editable: z.boolean(),
});
export type SettingDto = z.infer<typeof SettingDtoSchema>;

/** `GET /settings` and `PATCH /settings`: the keys the caller may read, grouped by scope (absent scopes are hidden). */
export const SettingsGroupsSchema = z.object({
  technical: z.array(SettingDtoSchema).optional(),
  hr: z.array(SettingDtoSchema).optional(),
  payroll: z.array(SettingDtoSchema).optional(),
});
export type SettingsGroups = z.infer<typeof SettingsGroupsSchema>;

/**
 * `PATCH /settings`: `{ changes: { "<key>": { value, version } } }`. Each key carries the version the client read, so
 * a concurrent edit of one key does not block edits of others; all changes apply in one transaction or none do.
 */
export const UpdateSettingsInputSchema = z
  .object({
    changes: z
      .record(z.string(), z.object({ value: z.unknown(), version: z.number().int().min(0) }).strict())
      .refine((o) => Object.keys(o).length > 0 && Object.keys(o).length <= 30, {
        message: 'Between 1 and 30 changes',
      }),
  })
  .strict();
export type UpdateSettingsInput = z.infer<typeof UpdateSettingsInputSchema>;
