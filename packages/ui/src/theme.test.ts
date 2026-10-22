import { describe, expect, it } from 'vitest';
import { readStoredTheme, THEME_STORAGE_KEY } from './theme';

const storage = (value: string | null) => ({
  getItem: (k: string) => (k === THEME_STORAGE_KEY ? value : null),
});

describe('readStoredTheme', () => {
  it('defaults to Ink (D-040)', () => {
    expect(readStoredTheme(storage(null))).toBe('ink');
    expect(readStoredTheme(undefined)).toBe('ink');
  });
  it('returns Paper only when explicitly chosen', () => {
    expect(readStoredTheme(storage('paper'))).toBe('paper');
    expect(readStoredTheme(storage('garbage'))).toBe('ink');
  });
  it('survives storage that throws', () => {
    expect(
      readStoredTheme({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe('ink');
  });
});
