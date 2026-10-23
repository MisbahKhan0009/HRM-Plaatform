import { describe, expect, it } from 'vitest';
import { type ImportLookups, resolveMapping, validateImport } from './import';

const lookups: ImportLookups = {
  departments: new Map([['ENG', 'dep-eng']]),
  positions: new Map([['engineer', 'pos-eng']]),
  employeeCodes: new Map([['EMP-0001', 'emp-1']]),
  workEmails: new Set(['taken@example.com']),
  requiredFields: ['firstName', 'lastName'],
  today: '2026-03-01',
};

const header = ['Employee Code', 'First Name', 'Last Name', 'Email', 'Department', 'Position', 'Manager'];
const J = '2024-01-01';

describe('resolveMapping', () => {
  it('maps common header spellings', () => {
    const { mapping, issues } = resolveMapping(header, undefined);
    expect(issues).toEqual([]);
    expect(mapping).toMatchObject({
      'Employee Code': 'employeeCode',
      Email: 'workEmail',
      Department: 'departmentCode',
      Manager: 'managerCode',
    });
  });

  it('reports unknown and duplicate columns in an explicit mapping', () => {
    const { issues } = resolveMapping(['A', 'B'], { A: 'firstName', B: 'firstName', C: 'lastName' });
    expect(issues.map((i) => i.code).sort()).toEqual(['duplicate_column', 'unknown_column']);
  });
});

describe('validateImport (FR-EMP-008, FR-EMP-009)', () => {
  it('accepts valid rows and resolves lookups and in-file managers', () => {
    const result = validateImport(
      [
        [...header, 'Joining Date'],
        ['N-1', 'Rahima', 'Akter', 'rahima@example.com', 'eng', 'Engineer', 'EMP-0001', J],
        ['N-2', 'Karim', 'Hossain', '', '', '', 'N-1', J],
      ],
      undefined,
      lookups,
    );
    expect(result.issues).toEqual([]);
    expect(result.rows.map((r) => r.valid)).toEqual([true, true]);
    expect(result.rows[0]?.value).toMatchObject({
      departmentId: 'dep-eng',
      positionId: 'pos-eng',
      manager: { id: 'emp-1' },
    });
    expect(result.rows[1]?.value.manager).toEqual({ rowCode: 'N-1' });
  });

  it('flags duplicates in the file and against existing employees', () => {
    const result = validateImport(
      [
        [...header, 'Joining Date'],
        ['EMP-0001', 'A', 'One', 'a@example.com', '', '', '', J],
        ['N-5', 'B', 'Two', 'same@example.com', '', '', '', J],
        ['N-6', 'C', 'Three', 'SAME@example.com', '', '', '', J],
        ['N-7', 'D', 'Four', 'taken@example.com', '', '', '', J],
      ],
      undefined,
      lookups,
    );
    expect(result.rows.map((r) => r.duplicate)).toEqual([true, true, true, true]);
    expect(result.issues.map((i) => `${i.row}${i.path}:${i.code}`)).toEqual([
      '1/employeeCode:duplicate_existing',
      '2/workEmail:duplicate_in_file',
      '3/workEmail:duplicate_in_file',
      '4/workEmail:duplicate_existing',
    ]);
  });

  it('rejects bad formats, unknown lookups and missing required values', () => {
    const result = validateImport(
      [
        [...header, 'Joining Date', 'Gender'],
        ['bad code!', '', 'X', 'not-an-email', 'NOPE', 'Pilot', 'ZZZ', '2026-02-30', 'robot'],
      ],
      undefined,
      { ...lookups, requiredFields: ['firstName', 'lastName', 'joiningDate'] },
    );
    expect(result.rows[0]?.valid).toBe(false);
    expect(result.issues.map((i) => `${i.path}:${i.code}`).sort()).toEqual(
      [
        '/departmentCode:not_found',
        '/employeeCode:invalid_format',
        '/firstName:required',
        '/gender:invalid_enum_value',
        '/joiningDate:invalid_date',
        '/managerCode:not_found',
        '/positionTitle:not_found',
        '/workEmail:invalid_format',
      ].sort(),
    );
  });

  it('rejects reporting cycles and rows whose manager row fails', () => {
    const result = validateImport(
      [
        [...header, 'Joining Date'],
        ['A', 'A', 'A', '', '', '', 'B', J],
        ['B', 'B', 'B', '', '', '', 'A', J],
        ['C', 'C', 'C', '', '', '', 'A', J],
        ['D', 'D', 'D', '', '', '', 'D', J],
      ],
      undefined,
      lookups,
    );
    expect(result.rows.map((r) => r.valid)).toEqual([false, false, false, false]);
    expect(result.issues.map((i) => `${i.row}:${i.code}`)).toEqual([
      '1:reporting_cycle',
      '2:reporting_cycle',
      '3:manager_not_imported',
      '4:self_manager',
    ]);
  });

  it('requires a column for every required field, and always a joining date', () => {
    const result = validateImport([['First Name'], ['A']], undefined, lookups);
    expect(result.issues).toEqual([
      { row: 0, path: '/mapping', code: 'missing_column', message: 'A lastName column is required.' },
      { row: 0, path: '/mapping', code: 'missing_column', message: 'A joiningDate column is required.' },
    ]);
  });

  it('accepts joining dates up to today and rejects later ones per row (BUSINESS-RULES §10)', () => {
    const result = validateImport(
      [
        ['First Name', 'Last Name', 'Joining Date', 'Probation End Date'],
        ['Old', 'Hand', '2019-07-01', ''],
        ['Today', 'Start', '2026-03-01', '2026-09-01'],
        ['Next', 'Month', '2026-04-01', ''],
        ['No', 'Date', '', ''],
      ],
      undefined,
      lookups,
    );
    expect(result.rows.map((r) => r.valid)).toEqual([true, true, false, false]);
    expect(result.issues.map((i) => `${i.row}${i.path}:${i.code}`)).toEqual([
      '3/joiningDate:date_in_future',
      '4/joiningDate:required',
    ]);
    expect(result.rows[1]?.value.probationEndDate).toBe('2026-09-01');
  });
});
