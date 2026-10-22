import { ERROR_CODES } from '@hrm/contracts';
import { describe, expect, it } from 'vitest';
import en from './locales/en.json';

describe('en catalogue', () => {
  it('only translates known error codes', () => {
    for (const code of Object.keys(en.errors)) {
      expect(ERROR_CODES).toContain(code);
    }
  });
});
