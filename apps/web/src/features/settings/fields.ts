import { SETTINGS, type SettingKey } from '@hrm/contracts';
import { z } from 'zod';

/** How a setting is edited. `fixed` values are shown read-only (the catalogue allows one value). */
export type FieldKind = 'fixed' | 'int' | 'retention' | 'bool' | 'text' | 'money' | 'choice' | 'multi';

export interface FieldDef {
  label: string;
  hint?: string;
  kind: FieldKind;
  /** Section heading on the page. */
  section: string;
  /** Unit after a number ("hours", "%"). */
  unit?: string;
  /** Options for `choice` and `multi`; '' stands for null. */
  options?: { value: string; label: string }[];
  /** Validation message when the value doesn't match the catalogue schema. */
  invalid?: string;
}

const RETENTION_HINT = 'Leave empty to keep files until someone deletes them.';
const retention = (label: string): FieldDef => ({
  label,
  kind: 'retention',
  section: 'Document retention',
  unit: 'days',
  hint: RETENTION_HINT,
});

/** Labels and controls for each catalogue key (BUSINESS-RULES §9). */
export const SETTING_FIELDS: Record<SettingKey, FieldDef> = {
  'company.timezone': { label: 'Time zone', kind: 'fixed', section: 'Company' },
  'company.currency': { label: 'Currency', kind: 'fixed', section: 'Payroll' },
  'company.locale_default': {
    label: 'Default language for new users',
    kind: 'choice',
    section: 'People',
    options: [
      { value: 'en', label: 'English' },
      { value: 'bn', label: 'Bangla' },
    ],
  },
  'employees.code_prefix': {
    label: 'Employee code prefix',
    kind: 'text',
    section: 'People',
    hint: 'New employees get the prefix and a number, for example EMP-0001.',
    invalid: 'Use 1 to 6 capital letters, optionally followed by a hyphen.',
  },
  'employees.code_padding': {
    label: 'Employee code digits',
    kind: 'int',
    section: 'People',
    hint: 'How many digits the number has, with leading zeros.',
  },
  'employees.required_fields': {
    label: 'Required when adding an employee',
    kind: 'multi',
    section: 'People',
    options: [
      { value: 'firstName', label: 'First name' },
      { value: 'lastName', label: 'Last name' },
      { value: 'joiningDate', label: 'Joining date' },
      { value: 'departmentId', label: 'Department' },
      { value: 'positionId', label: 'Position' },
      { value: 'workEmail', label: 'Work email' },
      { value: 'managerId', label: 'Manager' },
    ],
  },
  'attendance.checkout_window_hours': {
    label: 'Check-out window',
    kind: 'int',
    section: 'Attendance and leave',
    unit: 'hours',
    hint: 'A check-out counts for the latest check-in made within this many hours.',
  },
  'attendance.correction_window_days': {
    label: 'Correction window',
    kind: 'int',
    section: 'Attendance and leave',
    unit: 'days',
    hint: 'Employees can request corrections for days up to this many days ago.',
  },
  'leave.calendar.visible_to_team': {
    label: "Show colleagues' leave on the team calendar",
    kind: 'bool',
    section: 'Attendance and leave',
    hint: 'Employees see names and dates only, never the leave type.',
  },
  'approvals.hide_reviewer': {
    label: 'Hide who decided a request',
    kind: 'bool',
    section: 'Attendance and leave',
    hint: "Requesters see the decision and comment but not the reviewer's name.",
  },
  'payroll.anomaly_threshold_percent': {
    label: 'Net pay change warning',
    kind: 'int',
    section: 'Payroll',
    unit: '%',
    hint: 'Run checks flag employees whose net pay differs from their previous run by more than this.',
  },
  'payroll.allow_self_approval': {
    label: 'Allow the preparer to approve their own run',
    kind: 'bool',
    section: 'Payroll',
    hint: 'Self-approval needs a written reason and is flagged on the run.',
  },
  'payroll.midperiod_salary_change_policy': {
    label: 'Salary change during a month',
    kind: 'choice',
    section: 'Payroll',
    options: [
      { value: 'segment_proration', label: 'Prorate each salary by the days it applied' },
      { value: '', label: 'Not set: calculation stops until a rule is chosen' },
    ],
  },
  'reimbursements.review_threshold': {
    label: 'Large claim threshold',
    kind: 'money',
    section: 'Claims',
    hint: 'Run checks flag any claim above this amount.',
    invalid: 'Enter an amount with two decimals, for example 5000.00.',
  },
  'reimbursements.max_claim_age_days': {
    label: 'Oldest claim accepted',
    kind: 'int',
    section: 'Claims',
    unit: 'days',
    hint: 'Claims for expenses older than this are refused when submitted.',
  },
  'documents.max_upload_mb': { label: 'Largest upload', kind: 'int', section: 'Files', unit: 'MB' },
  'documents.retention_days.identity': retention('Identity documents'),
  'documents.retention_days.contract': retention('Contracts'),
  'documents.retention_days.certificate': retention('Certificates'),
  'documents.retention_days.payslip': retention('Payslips'),
  'documents.retention_days.receipt': retention('Receipts'),
  'documents.retention_days.policy': retention('Policies'),
  'documents.retention_days.other': retention('Other documents'),
  'security.session_idle_hours': {
    label: 'Sign out after inactivity',
    kind: 'int',
    section: 'Sessions',
    unit: 'hours',
  },
  'security.privileged_idle_hours': {
    label: 'Sign out admins after inactivity',
    kind: 'int',
    section: 'Sessions',
    unit: 'hours',
    hint: 'Applies to roles that need a passkey or authenticator app.',
  },
};

/** RHF treats dots as nesting, so keys become flat field names. */
export const fieldName = (key: string) => key.replaceAll('.', '__');

/** Form value (strings for inputs) from the stored value. */
export function toFormValue(kind: FieldKind, value: unknown): unknown {
  switch (kind) {
    case 'int':
      return typeof value === 'number' ? String(value) : '';
    case 'retention':
      return value === null || value === undefined ? '' : String(value);
    case 'choice':
      return value ?? '';
    case 'bool':
      return Boolean(value);
    case 'multi':
      return Array.isArray(value) ? value : [];
    case 'money':
      return moneyText(value);
    default:
      return value ?? '';
  }
}

/**
 * Money as a decimal string with two places. The API should send `"5000.00"`, but a plain number is tolerated and
 * converted as text, never through floating point arithmetic (ADR-0006).
 */
function moneyText(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const text = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) return text;
  const [int = '0', frac = ''] = text.split('.');
  return `${int}.${frac.padEnd(2, '0')}`;
}

/** The stored value as the form would send it back, so unchanged fields compare equal. */
export const normalizeStored = (kind: FieldKind, value: unknown) =>
  fromFormValue(kind, toFormValue(kind, value));

/** Stored value from the form value; `undefined` when the input can't be converted. */
export function fromFormValue(kind: FieldKind, raw: unknown): unknown {
  const text = typeof raw === 'string' ? raw.trim() : raw;
  switch (kind) {
    case 'int':
      return typeof text === 'string' && /^\d{1,9}$/.test(text) ? Number(text) : undefined;
    case 'retention':
      if (text === '') return null;
      return typeof text === 'string' && /^\d{1,9}$/.test(text) ? Number(text) : undefined;
    case 'choice':
      return text === '' ? null : text;
    default:
      return text;
  }
}

function bounds(schema: z.ZodType): { min: number | null; max: number | null } {
  const inner = schema instanceof z.ZodNullable ? schema.unwrap() : schema;
  return inner instanceof z.ZodNumber
    ? { min: inner.minValue, max: inner.maxValue }
    : { min: null, max: null };
}

export function numberBounds(key: SettingKey) {
  return bounds(SETTINGS[key].schema as z.ZodType);
}

/** Message for a value the catalogue schema rejects. */
export function invalidMessage(key: SettingKey): string {
  const def = SETTING_FIELDS[key];
  if (def.invalid) return def.invalid;
  const { min, max } = numberBounds(key);
  if (min !== null && max !== null) return `Enter a whole number from ${min} to ${max}.`;
  return 'Check this value.';
}

/** Validates each field with the contract's catalogue schema (FORMS-AND-VALIDATION §1). */
export function settingsFormSchema(keys: SettingKey[]) {
  return z.record(z.string(), z.unknown()).superRefine((values, ctx) => {
    for (const key of keys) {
      const def = SETTING_FIELDS[key];
      if (def.kind === 'fixed') continue;
      const value = fromFormValue(def.kind, values[fieldName(key)]);
      if (value === undefined || !SETTINGS[key].schema.safeParse(value).success) {
        ctx.addIssue({ code: 'custom', path: [fieldName(key)], message: invalidMessage(key) });
      }
    }
  });
}
