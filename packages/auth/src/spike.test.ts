/**
 * Stage 7 spike (AUTH-IMPLEMENTATION.md §10): runs the passwordless flow end-to-end against a real
 * Postgres and measures CPU per request. Skipped unless AUTH_SPIKE_DATABASE_URL is set.
 * Results are recorded in docs/05-backend/AUTH-SPIKE.md.
 */
import { createHmac } from 'node:crypto';
import { createDb, schema, uuidv7 } from '@hrm/db';
import { afterAll, describe, expect, it } from 'vitest';
import { createAuth } from './create-auth';

const url = process.env.AUTH_SPIKE_DATABASE_URL;
const BASE = 'http://localhost:8787';

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of input.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(secretBase32: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const h = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = (h[h.length - 1] ?? 0) & 0xf;
  const code = (h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

describe.skipIf(!url)('Better Auth passwordless spike', () => {
  const { db, sql } = createDb(url ?? '');
  const codes = new Map<string, string>();
  const auth = createAuth({
    db,
    schema,
    secret: 'spike-secret-at-least-32-characters-long!!',
    baseURL: BASE,
    sendSignInCode: async ({ email, otp }) => {
      codes.set(email, otp);
    },
    canSignIn: async () => true,
    onSignedIn: async () => {},
  });
  const cpu: Record<string, number[]> = {};

  let ip = '10.0.0.1';
  async function call(
    label: string,
    path: string,
    init: { method?: string; body?: unknown; cookie?: string } = {},
  ) {
    const req = new Request(`${BASE}/api/v1/auth${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: {
        'content-type': 'application/json',
        origin: BASE,
        'x-forwarded-for': ip,
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const start = process.cpuUsage();
    const res = await auth.handler(req);
    const used = process.cpuUsage(start);
    const samples = cpu[label] ?? [];
    samples.push((used.user + used.system) / 1000);
    cpu[label] = samples;
    return res;
  }

  const cookieOf = (res: Response) =>
    res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');

  afterAll(async () => {
    const rows = Object.entries(cpu).map(([k, v]) => {
      const sorted = [...v].sort((a, b) => a - b);
      return `${k.padEnd(28)} n=${String(v.length).padStart(2)}  median=${sorted[Math.floor(sorted.length / 2)]?.toFixed(2)} ms  max=${sorted.at(-1)?.toFixed(2)} ms`;
    });
    console.log(`\nCPU per request (Node ${process.version}, warm):\n${rows.join('\n')}`);
    await sql.end();
  });

  it('runs invite-only email OTP sign-in, then TOTP enrolment without a password', async () => {
    await sql`DELETE FROM rate_limits`; // spike database only: rate-limit counters persist between runs
    // Warm-up so module initialisation is not counted.
    await call('warmup', '/ok');
    const companyId = uuidv7();
    await db.insert(schema.companies).values({ id: companyId, name: 'Spike Co' });

    for (let i = 0; i < 30; i++) {
      ip = `10.0.${Math.floor(i / 200)}.${(i % 200) + 2}`;
      const email = `spike-${uuidv7()}@example.test`;
      await db.insert(schema.users).values({
        id: uuidv7(),
        companyId,
        name: 'Spike User',
        email,
        emailVerified: true,
        status: 'active',
      });

      const sent = await call('email-otp send', '/email-otp/send-verification-otp', {
        body: { email, type: 'sign-in' },
      });
      expect(sent.status).toBe(200);
      const otp = codes.get(email);
      expect(otp).toMatch(/^\d{6}$/);

      const signIn = await call('email-otp sign-in', '/sign-in/email-otp', { body: { email, otp } });
      expect(signIn.status).toBe(200);
      const cookie = cookieOf(signIn);

      const session = await call('get-session', '/get-session', { cookie });
      expect(((await session.json()) as { user: { email: string } }).user.email).toBe(email);

      const enable = await call('2fa enable (no password)', '/two-factor/enable', { body: {}, cookie });
      expect(enable.status).toBe(200);
      const { totpURI } = (await enable.json()) as { totpURI: string };
      const secret = new URL(totpURI).searchParams.get('secret') ?? '';

      const verify = await call('2fa verify-totp', '/two-factor/verify-totp', {
        body: { code: totp(secret) },
        cookie,
      });
      expect(verify.status).toBe(200);
    }

    // Invite-only: an unknown email must not create an account.
    const stranger = `stranger-${uuidv7()}@example.test`;
    await call('email-otp send', '/email-otp/send-verification-otp', {
      body: { email: stranger, type: 'sign-in' },
    });
    const strangerOtp = codes.get(stranger);
    if (strangerOtp) {
      const res = await call('email-otp sign-in', '/sign-in/email-otp', {
        body: { email: stranger, otp: strangerOtp },
      });
      expect(res.status).not.toBe(200);
    }
  }, 120_000);
});
