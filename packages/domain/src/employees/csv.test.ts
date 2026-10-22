import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

const encode = (rows: string[][], eol: string) =>
  rows
    .map((r) => r.map((c) => (/[",\r\n]/.test(c) || c === '' ? `"${c.replaceAll('"', '""')}"` : c)).join(','))
    .join(eol);

describe('parseCsv (RFC 4180, FR-EMP-008)', () => {
  it('parses quoted fields, escaped quotes, embedded newlines and CRLF', () => {
    const result = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"multi\nline",z\r\n', 10);
    expect(result).toEqual({
      ok: true,
      rows: [
        ['a', 'b'],
        ['x, y', 'say "hi"'],
        ['multi\nline', 'z'],
      ],
    });
  });

  it('strips a BOM, skips blank lines and keeps empty cells', () => {
    expect(parseCsv('﻿a,b\n\n1,\n', 10)).toEqual({
      ok: true,
      rows: [
        ['a', 'b'],
        ['1', ''],
      ],
    });
  });

  it('rejects an unterminated quote', () => {
    expect(parseCsv('a\n"oops', 10)).toMatchObject({ ok: false, reason: 'UNTERMINATED_QUOTE' });
  });

  it('rejects more rows than allowed and empty input', () => {
    expect(parseCsv('h\n1\n2\n3\n', 3)).toMatchObject({ ok: false, reason: 'TOO_MANY_ROWS' });
    expect(parseCsv('\n\n', 3)).toMatchObject({ ok: false, reason: 'EMPTY' });
  });

  it('round-trips any table written by an RFC 4180 encoder', () => {
    const cellArb = fc.string({ unit: fc.constantFrom('a', 'Z', '1', ' ', ',', '"', '\n', '\r', 'é') });
    const tableArb = fc
      .integer({ min: 1, max: 5 })
      .chain((width) =>
        fc.array(fc.array(cellArb, { minLength: width, maxLength: width }), { minLength: 1 }),
      );
    fc.assert(
      fc.property(tableArb, fc.constantFrom('\n', '\r\n'), (rows, eol) => {
        const parsed = parseCsv(encode(rows, eol), 1000);
        expect(parsed).toEqual({ ok: true, rows });
      }),
    );
  });
});
