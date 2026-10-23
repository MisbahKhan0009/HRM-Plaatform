import type { EmployeeRequirableField, ImportField } from '@hrm/contracts';
import { keysOnCycles } from './lifecycle';

/** Fields the import can fill (mirrors `importFieldValues` in `@hrm/contracts`). */
const FIELDS: readonly ImportField[] = [
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
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Common header spellings, after normalisation (lower case, letters and digits only). */
const ALIASES: Record<string, ImportField> = {
  code: 'employeeCode',
  employeeid: 'employeeCode',
  empcode: 'employeeCode',
  firstname: 'firstName',
  givenname: 'firstName',
  lastname: 'lastName',
  surname: 'lastName',
  familyname: 'lastName',
  email: 'workEmail',
  workemail: 'workEmail',
  phone: 'workPhone',
  workphone: 'workPhone',
  dob: 'dateOfBirth',
  birthdate: 'dateOfBirth',
  department: 'departmentCode',
  departmentcode: 'departmentCode',
  position: 'positionTitle',
  title: 'positionTitle',
  jobtitle: 'positionTitle',
  manager: 'managerCode',
  managercode: 'managerCode',
  joiningdate: 'joiningDate',
  joindate: 'joiningDate',
  startdate: 'joiningDate',
};
for (const f of FIELDS) ALIASES[norm(f)] = f;

/** Which import column satisfies each `employees.required_fields` entry (BUSINESS-RULES §9). */
const REQUIRED_COLUMN: Record<EmployeeRequirableField, ImportField> = {
  firstName: 'firstName',
  lastName: 'lastName',
  joiningDate: 'joiningDate',
  departmentId: 'departmentCode',
  positionId: 'positionTitle',
  workEmail: 'workEmail',
  managerId: 'managerCode',
};

export interface ImportIssue {
  /** 1-based data row; 0 for problems with the header or mapping. */
  row: number;
  path: string;
  code: string;
  message: string;
}

export interface ImportLookups {
  /** Department code (upper case) → id. */
  departments: ReadonlyMap<string, string>;
  /** Position title (lower case) → id. */
  positions: ReadonlyMap<string, string>;
  /** Existing employee code → id. */
  employeeCodes: ReadonlyMap<string, string>;
  /** Existing work emails, lower case. */
  workEmails: ReadonlySet<string>;
  requiredFields: readonly EmployeeRequirableField[];
}

export interface ImportedEmployee {
  employeeCode: string | null;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  workEmail: string | null;
  workPhone: string | null;
  dateOfBirth: string | null;
  gender: 'female' | 'male' | 'other' | 'undisclosed' | null;
  departmentId: string | null;
  positionId: string | null;
  /** An existing employee's id, or the code of another row in the same file. */
  manager: { id: string } | { rowCode: string } | null;
  joiningDate: string | null;
  probationEndDate: string | null;
}

export interface ImportRowOutcome {
  row: number;
  valid: boolean;
  duplicate: boolean;
  value: ImportedEmployee;
}

export interface ImportValidation {
  mapping: Record<string, ImportField | null>;
  rows: ImportRowOutcome[];
  issues: ImportIssue[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE = /^[A-Za-z0-9-]{1,30}$/;
const GENDERS = new Set(['female', 'male', 'other', 'undisclosed']);

function isIsoDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Column index per field: from an explicit mapping, otherwise by header name. Header problems are row 0. */
export function resolveMapping(
  header: readonly string[],
  explicit: Readonly<Record<string, ImportField | null>> | undefined,
): { mapping: Record<string, ImportField | null>; columns: Map<ImportField, number>; issues: ImportIssue[] } {
  const mapping: Record<string, ImportField | null> = {};
  const columns = new Map<ImportField, number>();
  const issues: ImportIssue[] = [];
  const headers = header.map((h) => h.trim());
  if (explicit) {
    for (const name of Object.keys(explicit)) {
      if (!headers.includes(name))
        issues.push({ row: 0, path: '/mapping', code: 'unknown_column', message: `No column "${name}".` });
    }
  }
  headers.forEach((h, index) => {
    const field = explicit ? (explicit[h] ?? null) : (ALIASES[norm(h)] ?? null);
    mapping[h] = field;
    if (!field) return;
    if (columns.has(field))
      issues.push({
        row: 0,
        path: '/mapping',
        code: 'duplicate_column',
        message: `Two columns map to ${field}.`,
      });
    else columns.set(field, index);
  });
  return { mapping, columns, issues };
}

/**
 * Validates import rows (FR-EMP-008, FR-EMP-009): formats, required fields from `employees.required_fields`, lookups
 * of department, position and manager, duplicate work emails and codes (in the file and against existing employees),
 * and reporting cycles among the file's manager links (BUSINESS-RULES §7.1). A row whose manager is another file row
 * that cannot be imported is invalid too. Pure: every lookup is passed in.
 */
export function validateImport(
  table: readonly (readonly string[])[],
  explicitMapping: Readonly<Record<string, ImportField | null>> | undefined,
  lookups: ImportLookups,
): ImportValidation {
  const [header = [], ...data] = table;
  const { mapping, columns, issues } = resolveMapping(header, explicitMapping);
  if (issues.length) return { mapping, rows: [], issues };

  const required = new Set(lookups.requiredFields.map((f) => REQUIRED_COLUMN[f]));
  required.add('firstName');
  required.add('lastName');
  for (const f of required) {
    if (!columns.has(f))
      issues.push({
        row: 0,
        path: '/mapping',
        code: 'missing_column',
        message: `A ${f} column is required.`,
      });
  }
  if (issues.length) return { mapping, rows: [], issues };

  const rowErrors = new Map<number, ImportIssue[]>();
  const fail = (row: number, field: string, code: string, message: string) => {
    const list = rowErrors.get(row) ?? [];
    list.push({ row, path: `/${field}`, code, message });
    rowErrors.set(row, list);
  };

  const cell = (cells: readonly string[], f: ImportField) => {
    const i = columns.get(f);
    const v = i === undefined ? '' : (cells[i] ?? '').trim();
    return v === '' ? null : v;
  };

  const values: ImportedEmployee[] = [];
  const codeRows = new Map<string, number[]>();
  const emailRows = new Map<string, number[]>();

  data.forEach((cells, index) => {
    const row = index + 1;
    const text = (f: ImportField, max: number) => {
      const v = cell(cells, f);
      if (v !== null && v.length > max) fail(row, f, 'too_big', `At most ${max} characters.`);
      return v;
    };
    const date = (f: ImportField) => {
      const v = cell(cells, f);
      if (v !== null && !isIsoDate(v)) fail(row, f, 'invalid_date', 'Expected a date like 2026-01-31.');
      return v;
    };

    const employeeCode = cell(cells, 'employeeCode');
    if (employeeCode !== null && !CODE.test(employeeCode))
      fail(row, 'employeeCode', 'invalid_format', 'Letters, digits and dashes only (at most 30).');
    const workEmail = cell(cells, 'workEmail');
    if (workEmail !== null && (workEmail.length > 254 || !EMAIL.test(workEmail)))
      fail(row, 'workEmail', 'invalid_format', 'Not a valid email address.');
    const genderText = cell(cells, 'gender')?.toLowerCase() ?? null;
    if (genderText !== null && !GENDERS.has(genderText))
      fail(row, 'gender', 'invalid_enum_value', 'Use female, male, other or undisclosed.');

    const departmentCode = cell(cells, 'departmentCode');
    const departmentId = departmentCode
      ? (lookups.departments.get(departmentCode.toUpperCase()) ?? null)
      : null;
    if (departmentCode && !departmentId) fail(row, 'departmentCode', 'not_found', 'Unknown department code.');
    const positionTitle = cell(cells, 'positionTitle');
    const positionId = positionTitle ? (lookups.positions.get(positionTitle.toLowerCase()) ?? null) : null;
    if (positionTitle && !positionId) fail(row, 'positionTitle', 'not_found', 'Unknown position title.');

    const value: ImportedEmployee = {
      employeeCode,
      firstName: text('firstName', 100) ?? '',
      lastName: text('lastName', 100) ?? '',
      preferredName: text('preferredName', 100),
      workEmail,
      workPhone: text('workPhone', 40),
      dateOfBirth: date('dateOfBirth'),
      gender: genderText as ImportedEmployee['gender'],
      departmentId,
      positionId,
      manager: null,
      joiningDate: date('joiningDate'),
      probationEndDate: date('probationEndDate'),
    };
    if (value.joiningDate && value.probationEndDate && value.probationEndDate <= value.joiningDate)
      fail(row, 'probationEndDate', 'date_before_start', 'Probation must end after the joining date.');
    for (const f of required) {
      if (cell(cells, f) === null) fail(row, f, 'required', 'Required.');
    }
    if (employeeCode) codeRows.set(employeeCode, [...(codeRows.get(employeeCode) ?? []), row]);
    if (workEmail) {
      const key = workEmail.toLowerCase();
      emailRows.set(key, [...(emailRows.get(key) ?? []), row]);
    }
    values.push(value);
  });

  const duplicates = new Set<number>();
  for (const [code, rows] of codeRows) {
    const exists = lookups.employeeCodes.has(code);
    if (rows.length < 2 && !exists) continue;
    for (const r of rows) {
      duplicates.add(r);
      fail(
        r,
        'employeeCode',
        exists ? 'duplicate_existing' : 'duplicate_in_file',
        exists ? 'An employee already has this code.' : 'Another row has this code.',
      );
    }
  }
  for (const [email, rows] of emailRows) {
    const exists = lookups.workEmails.has(email);
    if (rows.length < 2 && !exists) continue;
    for (const r of rows) {
      duplicates.add(r);
      fail(
        r,
        'workEmail',
        exists ? 'duplicate_existing' : 'duplicate_in_file',
        exists ? 'An employee already has this work email.' : 'Another row has this work email.',
      );
    }
  }

  // Manager links: an existing employee code, or the code of another row in this file.
  const fileLinks = new Map<string, string>();
  const rowByCode = new Map<string, number>();
  for (const [code, rows] of codeRows) if (rows.length === 1 && rows[0]) rowByCode.set(code, rows[0]);
  values.forEach((v, index) => {
    const row = index + 1;
    const managerCode = cell(data[index] ?? [], 'managerCode');
    if (!managerCode) return;
    if (v.employeeCode && managerCode === v.employeeCode) {
      fail(row, 'managerCode', 'self_manager', 'An employee cannot be their own manager.');
      return;
    }
    const existing = lookups.employeeCodes.get(managerCode);
    if (existing && !rowByCode.has(managerCode)) v.manager = { id: existing };
    else if (rowByCode.has(managerCode)) {
      v.manager = { rowCode: managerCode };
      if (v.employeeCode) fileLinks.set(v.employeeCode, managerCode);
    } else fail(row, 'managerCode', 'not_found', 'Unknown manager code.');
  });
  for (const code of keysOnCycles(fileLinks)) {
    const row = rowByCode.get(code);
    if (row) fail(row, 'managerCode', 'reporting_cycle', 'These rows form a reporting cycle.');
  }

  // A row whose manager row will not be imported cannot be imported either (repeat for chains).
  let changed = true;
  while (changed) {
    changed = false;
    values.forEach((v, index) => {
      const row = index + 1;
      if (rowErrors.has(row) || !v.manager || !('rowCode' in v.manager)) return;
      const managerRow = rowByCode.get(v.manager.rowCode);
      if (managerRow && rowErrors.has(managerRow)) {
        fail(row, 'managerCode', 'manager_not_imported', 'The manager row has errors.');
        changed = true;
      }
    });
  }

  const rows = values.map((value, index) => {
    const row = index + 1;
    return { row, valid: !rowErrors.has(row), duplicate: duplicates.has(row), value };
  });
  const all = [...rowErrors.keys()].sort((a, b) => a - b).flatMap((r) => rowErrors.get(r) ?? []);
  return { mapping, rows, issues: all };
}
