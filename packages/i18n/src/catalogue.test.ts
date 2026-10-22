import { ERROR_CODES } from '@hrm/contracts';
import { describe, expect, it } from 'vitest';
import en from './locales/en.json';

describe('en catalogue', () => {
  it('only translates known error codes', () => {
    for (const code of Object.keys(en.errors)) {
      if (code === 'NETWORK') continue; // client-side network failure, not an API code
      expect(ERROR_CODES).toContain(code);
    }
  });

  it('has a message for every API error code (CONTENT-STYLE §6)', () => {
    for (const code of ERROR_CODES) expect(Object.keys(en.errors)).toContain(code);
  });
});
