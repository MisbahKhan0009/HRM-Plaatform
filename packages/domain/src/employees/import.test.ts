import { describe, expect, it } from 'vitest';
import { type ImportLookups, resolveMapping, validateImport } from './import';

const lookups: ImportLookups = {
  departments: new Map([['ENG', 'dep-eng']]),
  positions: new Map([['engineer', 'pos-eng']]),
  employeeCodes: new Map([['EMP-0001', 'emp-1']]),
  workEmails: new Set(['taken@example.com']),
  requiredFields: ['firstName', 'lastName'],
};

const header = ['Employee Code', 'First Name', 'Last Name', 'Email', 'Department', 'Position', 'Manager'];

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
        header,
        ['N-1', 'Rahima', 'Akter', 'rahima@example.com', 'eng', 'Engineer', 'EMP-0001'],
        ['N-2', 'Karim', 'Hossain', '', '', '', 'N-1'],
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
        header,
        ['EMP-0001', 'A', 'One', 'a@example.com', '', '', ''],
        ['N-5', 'B', 'Two', 'same@example.com', '', '', ''],
        ['N-6', 'C', 'Three', 'SAME@example.com', '', '', ''],
        ['N-7', 'D', 'Four', 'taken@example.com', '', '', ''],
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
        header,
        ['A', 'A', 'A', '', '', '', 'B'],
        ['B', 'B', 'B', '', '', '', 'A'],
        ['C', 'C', 'C', '', '', '', 'A'],
        ['D', 'D', 'D', '', '', '', 'D'],
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

  it('requires a column for every required field', () => {
    const result = validateImport([['First Name'], ['A']], undefined, lookups);
    expect(result.issues).toEqual([
      { row: 0, path: '/mapping', code: 'missing_column', message: 'A lastName column is required.' },
    ]);
  });
});
