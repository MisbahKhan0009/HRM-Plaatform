import type { OutgoingEmail } from './types';

const encoder = new TextEncoder();

function base64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** RFC 2047 encoded-word for non-ASCII header values. */
export function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${base64(encoder.encode(value))}?=`;
}

/** Wraps base64 at 76 characters (RFC 2045). */
function wrap(b64: string): string {
  return b64.replace(/.{1,76}/g, '$&\r\n');
}

/**
 * Builds a multipart/alternative RFC 2822 message (EMAIL.md §2): small and dependency-free to stay within the
 * Worker CPU budget. Bodies are base64 so any UTF-8 text is safe.
 */
export function buildMime(email: OutgoingEmail, from: string, boundary: string): string {
  const headers = [
    `From: ${from}`,
    `To: ${email.to}`,
    `Subject: ${encodeHeader(email.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ...(email.replyTo ? [`Reply-To: ${email.replyTo}`] : []),
    ...Object.entries(email.headers ?? {}).map(([k, v]) => `${k}: ${encodeHeader(v)}`),
  ];
  const part = (type: string, body: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset=UTF-8`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap(base64(encoder.encode(body))),
    ].join('\r\n');
  return [
    ...headers,
    '',
    part('text/plain', email.text),
    part('text/html', email.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/** base64url without padding, as the Gmail API `raw` field expects. */
export function base64Url(text: string): string {
  return base64(encoder.encode(text)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
