import { describe, expect, it } from 'vitest';
import {
  contentDisposition,
  matchesDeclared,
  safeFileName,
  sniffMimeType,
  storageKey,
} from '../../src/modules/documents/documents.files';

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => new TextEncoder().encode(s);

describe('sniffMimeType', () => {
  it.each([
    ['PDF', ascii('%PDF-1.7'), 'application/pdf'],
    ['PNG', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'image/png'],
    ['JPEG', bytes(0xff, 0xd8, 0xff, 0xdb), 'image/jpeg'],
    ['WebP', ascii('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '), 'image/webp'],
  ])('recognises %s', (_label, head, mime) => {
    expect(sniffMimeType(head)).toBe(mime);
  });

  it.each([
    ['an executable', bytes(0x4d, 0x5a, 0x90, 0x00)],
    ['a ZIP archive', bytes(0x50, 0x4b, 0x03, 0x04)],
    ['SVG', ascii('<svg xmlns="http://www.w3.org/2000/svg">')],
    ['HTML', ascii('<!doctype html>')],
    ['a RIFF that is not WebP', ascii('RIFF\u0000\u0000\u0000\u0000WAVEfmt ')],
    ['empty content', bytes()],
  ])('rejects %s', (_label, head) => {
    expect(sniffMimeType(head)).toBeNull();
  });
});

describe('matchesDeclared', () => {
  it('accepts matching, empty and generic declared types', () => {
    expect(matchesDeclared('image/jpeg', 'image/jpg', 'a.JPEG')).toBe(true);
    expect(matchesDeclared('application/pdf', '', 'a.pdf')).toBe(true);
    expect(matchesDeclared('application/pdf', 'application/octet-stream', 'scan')).toBe(true);
  });

  it('rejects a mismatching declared type or extension', () => {
    expect(matchesDeclared('image/png', 'application/pdf', 'a.png')).toBe(false);
    expect(matchesDeclared('application/pdf', 'application/pdf', 'a.exe')).toBe(false);
  });
});

describe('safeFileName', () => {
  it('drops paths, control characters, quotes and leading dots', () => {
    expect(safeFileName('../../etc/passwd', 'application/pdf')).toBe('passwd.pdf');
    expect(safeFileName('C:\\temp\\"bad"\u0000name.pdf', 'application/pdf')).toBe('badname.pdf');
    expect(safeFileName('...hidden.png', 'image/png')).toBe('hidden.png');
    expect(safeFileName('', 'image/webp')).toBe('document.webp');
  });

  it('keeps names at most 150 characters with their extension', () => {
    const name = safeFileName(`${'x'.repeat(400)}.pdf`, 'application/pdf');
    expect(name).toHaveLength(150);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});

describe('contentDisposition', () => {
  it('is always an attachment with an ASCII fallback and the UTF-8 name', () => {
    expect(contentDisposition('চুক্তি.pdf')).toBe(
      `attachment; filename="______.pdf"; filename*=UTF-8''${encodeURIComponent('চুক্তি.pdf')}`,
    );
  });
});

describe('storageKey', () => {
  it('is generated from ids only', () => {
    expect(storageKey(null, 'doc', 2)).toBe('documents/company/doc/v2');
    expect(storageKey('emp', 'doc', 1)).toBe('documents/emp/doc/v1');
  });
});
