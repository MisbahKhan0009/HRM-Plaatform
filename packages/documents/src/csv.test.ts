import { describe, expect, it } from 'vitest';
import { toCsv } from './index';

describe('toCsv', () => {
  it('quotes separators and doubles quotes', () => {
    expect(toCsv([['a,b', 'say "hi"', null]])).toBe('"a,b","say ""hi""",');
  });
  it('neutralises spreadsheet formulas', () => {
    expect(toCsv([['=SUM(A1)']])).toBe("'=SUM(A1)");
  });
});
