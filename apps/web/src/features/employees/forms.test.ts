import { describe, expect, it } from 'vitest';
import { employeeFormDefaults, employeeFormSchema } from './forms';
import { displayValue } from './labels';

describe('employeeFormSchema', () => {
  const valid = {
    ...employeeFormDefaults(),
    firstName: 'Nadia',
    lastName: 'Rahman',
    joiningDate: '2026-01-05',
    departmentId: '01a165e5-8c44-7b40-a525-9b9887726127',
    positionId: '01a165e5-8d27-7a2a-b056-851eeda2edc3',
  };

  it('maps empty optional inputs to null', () => {
    const out = employeeFormSchema([]).parse(valid);
    expect(out.preferredName).toBeNull();
    expect(out.workEmail).toBeNull();
    expect(out.managerId).toBeNull();
    expect(out.joiningDate).toBe('2026-01-05');
  });

  it('flags fields the company requires', () => {
    const result = employeeFormSchema(['workEmail', 'managerId']).safeParse(valid);
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['workEmail', 'managerId']));
  });

  it('says "Required." for an empty name', () => {
    const result = employeeFormSchema([]).safeParse({ ...valid, firstName: '  ' });
    expect(result.error?.issues[0]?.message).toBe('Required.');
  });

  it('keeps the contract rules for filled fields', () => {
    expect(employeeFormSchema([]).safeParse({ ...valid, workEmail: 'not-an-email' }).success).toBe(false);
  });
});

describe('displayValue', () => {
  it('formats dates, enums and emergency contacts', () => {
    expect(displayValue('dateOfBirth', '1996-04-12')).toBe('12 Apr 1996');
    expect(displayValue('gender', 'undisclosed')).toBe('Prefer not to say');
    expect(displayValue('separationType', 'contract_end')).toBe('End of contract');
    expect(
      displayValue('emergencyContacts', [{ name: 'Karim', relationship: 'Father', phone: '+8801800000000' }]),
    ).toBe('Karim (Father) +8801800000000');
    expect(displayValue('emergencyContacts', [])).toBe('None');
    expect(displayValue('personalPhone', null)).toBe('—');
  });
});
