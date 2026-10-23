import { describe, expect, it } from 'vitest';
import { expiryState } from './expiry';
import { checkFile, fileProblemMessage, formatBytes, MAX_UPLOAD_BYTES } from './files';

describe('checkFile (COMPONENT-SPECS §6)', () => {
  it('accepts PDF, PNG, JPEG and WebP within the limit', () => {
    expect(checkFile({ name: 'a.pdf', type: 'application/pdf', size: 10 })).toBeNull();
    expect(checkFile({ name: 'a.JPG', type: 'image/jpeg', size: 10 })).toBeNull();
    expect(checkFile({ name: 'a.webp', type: 'image/webp', size: MAX_UPLOAD_BYTES })).toBeNull();
  });
  it('rejects other types, mismatched extensions and empty files', () => {
    expect(checkFile({ name: 'a.svg', type: 'image/svg+xml', size: 10 })).toBe('type');
    expect(checkFile({ name: 'a.png', type: 'application/pdf', size: 10 })).toBe('type');
    expect(checkFile({ name: 'a.html', type: 'text/html', size: 10 })).toBe('type');
    expect(checkFile({ name: 'a.pdf', type: 'application/pdf', size: 0 })).toBe('type');
  });
  it('rejects files over 10 MB with the size in the message', () => {
    const size = MAX_UPLOAD_BYTES + 1;
    expect(checkFile({ name: 'a.pdf', type: 'application/pdf', size })).toBe('size');
    expect(fileProblemMessage('size', 12 * 1024 * 1024)).toBe('This file is 12.0 MB. The limit is 10 MB.');
  });
  it('formats sizes', () => {
    expect([512, 290_000, 1_300_000].map(formatBytes)).toEqual(['512 B', '283 KB', '1.2 MB']);
  });
});

describe('expiryState', () => {
  it('marks past dates expired and the next 30 days expiring', () => {
    expect(expiryState('2026-10-21', '2026-10-22')).toBe('expired');
    expect(expiryState('2026-10-22', '2026-10-22')).toBe('expiring');
    expect(expiryState('2026-11-21', '2026-10-22')).toBe('expiring');
    expect(expiryState('2026-11-22', '2026-10-22')).toBeNull();
    expect(expiryState(null, '2026-10-22')).toBeNull();
  });
});
