import { SETTING_KEYS, SETTINGS } from '@hrm/contracts';
import { describe, expect, it } from 'vitest';
import {
  fieldName,
  fromFormValue,
  invalidMessage,
  normalizeStored,
  SETTING_FIELDS,
  settingsFormSchema,
  toFormValue,
} from './fields';

describe('settings fields', () => {
  it('has a field for every catalogue key', () => {
    for (const key of SETTING_KEYS) expect(SETTING_FIELDS[key]).toBeDefined();
  });

  it('round-trips every seed default through the form', () => {
    for (const key of SETTING_KEYS) {
      const { kind } = SETTING_FIELDS[key];
      if (kind === 'fixed') continue;
      expect(fromFormValue(kind, toFormValue(kind, SETTINGS[key].default))).toEqual(SETTINGS[key].default);
    }
  });

  it('keeps retention empty as null and numbers as integers', () => {
    expect(fromFormValue('retention', '')).toBeNull();
    expect(fromFormValue('retention', ' 365 ')).toBe(365);
    expect(fromFormValue('int', '1.5')).toBeUndefined();
    expect(fromFormValue('choice', '')).toBeNull();
  });

  it('shows money as a two-place decimal string without float arithmetic', () => {
    expect(toFormValue('money', '5000.00')).toBe('5000.00');
    expect(toFormValue('money', 5000)).toBe('5000.00');
    expect(toFormValue('money', '12.5')).toBe('12.50');
    expect(normalizeStored('money', 5000)).toBe('5000.00');
  });

  it('validates with the catalogue schema and a readable message', () => {
    const keys = ['security.session_idle_hours', 'employees.code_prefix'] as const;
    const schema = settingsFormSchema([...keys]);
    const ok = schema.safeParse({ [fieldName(keys[0])]: '8', [fieldName(keys[1])]: 'EMP-' });
    expect(ok.success).toBe(true);
    const bad = schema.safeParse({ [fieldName(keys[0])]: '25', [fieldName(keys[1])]: 'emp' });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.map((i) => i.message)).toEqual([
      invalidMessage('security.session_idle_hours'),
      invalidMessage('employees.code_prefix'),
    ]);
    expect(invalidMessage('security.session_idle_hours')).toBe('Enter a whole number from 1 to 24.');
  });
});
