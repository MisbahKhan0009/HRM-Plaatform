const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string) {
  const s = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** 32 random bytes as base64url (43 characters): invitation tokens. */
export function randomToken() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 hex digest: tokens are stored hashed, never in plain text. */
export async function sha256Hex(text: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sealKey(secret: string) {
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('hrm-outbox-seal'), info: new Uint8Array() },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypts a value that must sit in the outbox until an email is sent (the raw invitation token): AES-GCM with a
 * key derived from BETTER_AUTH_SECRET, so a database copy alone does not reveal it.
 */
export async function seal(secret: string, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealKey(secret), encoder.encode(value)),
  );
  return `${toBase64Url(iv)}.${toBase64Url(data)}`;
}

export async function unseal(secret: string, sealed: string) {
  const [iv, data] = sealed.split('.');
  if (!iv || !data) throw new Error('Malformed sealed value');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(iv) },
    await sealKey(secret),
    fromBase64Url(data),
  );
  return new TextDecoder().decode(plain);
}
