import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { schema, uuidv7 } from '@hrm/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { memoryMailer } from '../../src/lib/mailer';
import {
  auditFor,
  call,
  eventually,
  type Fixture,
  json,
  login,
  outboxFor,
  setupCompany,
  type TestUser,
} from '../harness';

let f: Fixture;
let admin: TestUser;
let hr: TestUser;
let employee: TestUser;
let other: Fixture;

beforeAll(async () => {
  f = await setupCompany('Users Co');
  admin = await f.signIn({ roles: ['system_admin'] });
  hr = await f.signIn({ roles: ['hr_admin'] });
  employee = await f.signIn({ employee: true, strong: false });
  other = await setupCompany('Other Users Co');
});

const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

type Detail = {
  id: string;
  email: string;
  status: string;
  roles: string[];
  derivedRoles: string[];
  employee: { id: string } | null;
  invitation: { expiresAt: string; expired: boolean } | null;
  enrolment: { hasPasskey: boolean; hasTotp: boolean };
  version: number;
};

const getUser = async (id: string) =>
  json<Detail>(await call('GET', `/api/v1/users/${id}`, { cookie: admin.cookie }));

/** Merges Set-Cookie values from a response into a Cookie header. */
function mergeCookies(cookie: string, res: Response) {
  const jar = new Map(
    cookie
      .split('; ')
      .filter(Boolean)
      .map((c) => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)] as const),
  );
  for (const sc of res.headers.getSetCookie()) {
    const pair = sc.split(';')[0] ?? '';
    jar.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

const tokenFrom = (text: string) => /accept-invite\/([A-Za-z0-9_-]{43})/.exec(text)?.[1];

describe('GET /users', () => {
  it('lists users with status and text filters', async () => {
    const named = await f.user({ name: 'Zebra Findable', status: 'suspended' });
    const res = await call('GET', '/api/v1/users?status=suspended&q=zebra', { cookie: hr.cookie });
    expect(res.status).toBe(200);
    const body = await json<{ data: { id: string; status: string }[]; page: { totalItems: number } }>(res);
    expect(body.data.map((u) => u.id)).toEqual([named.userId]);
    expect(body.page.totalItems).toBe(1);
  });

  it('treats LIKE wildcards in q as plain text', async () => {
    const res = await call('GET', '/api/v1/users?q=%25', { cookie: hr.cookie });
    expect((await json<{ data: unknown[] }>(res)).data).toEqual([]);
  });

  it('never lists another company’s users', async () => {
    const stranger = await other.user({ name: 'Stranger Danger' });
    const body = await json<{ data: { id: string }[] }>(
      await call('GET', '/api/v1/users?q=Stranger', { cookie: hr.cookie }),
    );
    expect(body.data.map((u) => u.id)).not.toContain(stranger.userId);
  });

  it('returns 400 for an unknown status', async () => {
    const res = await call('GET', '/api/v1/users?status=gone', { cookie: hr.cookie });
    expect(res.status).toBe(400);
  });

  it('returns 403 to an employee', async () => {
    const res = await call('GET', '/api/v1/users', { cookie: employee.cookie });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('FORBIDDEN');
  });
});

describe('POST /users/invitations', () => {
  it('creates an invited user, a hashed token, an audit row and a queued email', async () => {
    const empId = await f.employee({ firstName: 'Ina' });
    const email = `invitee-${uuidv7()}@example.test`;
    const res = await call('POST', '/api/v1/users/invitations', {
      cookie: hr.cookie,
      body: { email, name: 'Ina Invitee', employeeId: empId },
    });
    expect(res.status).toBe(201);
    const user = await json<Detail>(res);
    expect(user).toMatchObject({ email, status: 'invited', roles: [], derivedRoles: ['employee'] });
    expect(user.employee?.id).toBe(empId);
    expect(user.invitation?.expired).toBe(false);
    const days = (Date.parse(user.invitation?.expiresAt ?? '') - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
    expect(res.headers.get('Location')).toBe(`/api/v1/users/${user.id}`);

    const [inv] = await f.db.select().from(schema.invitations).where(eq(schema.invitations.userId, user.id));
    expect(inv?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const audits = await auditFor(f.db, user.id);
    expect(audits.map((a) => a.action)).toEqual(['user.invited']);
    expect(audits[0]).toMatchObject({ category: 'security', employeeId: empId });

    const outbox = (await outboxFor(f.db, f.companyId, ['email.invitation'])).filter(
      (m) => (m.payload as { userId: string }).userId === user.id,
    );
    expect(outbox).toHaveLength(1);
    const mail = await eventually(async () => memoryMailer.lastTo(email));
    const token = tokenFrom(mail.text);
    expect(token).toBeDefined();
    // The raw token never sits in the outbox in clear text.
    expect(JSON.stringify(outbox[0]?.payload)).not.toContain(token);
  });

  it('rejects an email already used, ignoring case (EMAIL_TAKEN)', async () => {
    const existing = await f.user();
    const res = await call('POST', '/api/v1/users/invitations', {
      cookie: hr.cookie,
      body: { email: existing.email.toUpperCase(), name: 'Dup' },
    });
    expect(res.status).toBe(409);
    const body = await json<{ code: string; errors: { path: string }[] }>(res);
    expect(body.code).toBe('EMAIL_TAKEN');
    expect(body.errors[0]?.path).toBe('/email');
  });

  it('rejects an employee who already has a user (EMPLOYEE_ALREADY_LINKED)', async () => {
    const linked = await f.user({ employee: true });
    const res = await call('POST', '/api/v1/users/invitations', {
      cookie: hr.cookie,
      body: { email: `x-${uuidv7()}@example.test`, name: 'X', employeeId: linked.employeeId },
    });
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe('EMPLOYEE_ALREADY_LINKED');
  });

  it('treats another company’s employee as unknown', async () => {
    const foreign = await other.employee();
    const res = await call('POST', '/api/v1/users/invitations', {
      cookie: hr.cookie,
      body: { email: `x-${uuidv7()}@example.test`, name: 'X', employeeId: foreign },
    });
    expect(res.status).toBe(400);
    expect((await json<{ errors: { path: string }[] }>(res)).errors[0]?.path).toBe('/employeeId');
  });

  it('rejects derived roles at validation', async () => {
    const res = await call('POST', '/api/v1/users/invitations', {
      cookie: admin.cookie,
      body: { email: `x-${uuidv7()}@example.test`, name: 'X', roleCodes: ['manager'] },
    });
    expect(res.status).toBe(400);
    expect((await json<{ errors: { path: string }[] }>(res)).errors[0]?.path).toMatch(/^\/roleCodes/);
  });

  it('needs role.manage to grant roles at invitation', async () => {
    const res = await call('POST', '/api/v1/users/invitations', {
      cookie: hr.cookie,
      body: { email: `x-${uuidv7()}@example.test`, name: 'X', roleCodes: ['system_admin'] },
    });
    expect(res.status).toBe(403);
  });

  it('lets an admin with role.manage grant explicit roles, audited as role.granted', async () => {
    const res = await call('POST', '/api/v1/users/invitations', {
      cookie: admin.cookie,
      body: { email: `aud-${uuidv7()}@example.test`, name: 'Audrey', roleCodes: ['auditor'] },
    });
    expect(res.status).toBe(201);
    const user = await json<Detail>(res);
    expect(user.roles).toEqual(['auditor']);
    const audits = await auditFor(f.db, user.id);
    expect(audits.map((a) => a.action)).toEqual(['user.invited', 'role.granted']);
    expect(audits[1]?.metadata).toEqual({ roleCode: 'auditor' });
  });

  it('returns 400 for a malformed email', async () => {
    const res = await call('POST', '/api/v1/users/invitations', {
      cookie: hr.cookie,
      body: { email: 'not-an-email', name: 'X' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 403 to an employee and MFA_REQUIRED to a weak HR session', async () => {
    const body = { email: `x-${uuidv7()}@example.test`, name: 'X' };
    expect((await call('POST', '/api/v1/users/invitations', { cookie: employee.cookie, body })).status).toBe(
      403,
    );
    const weak = await f.signIn({ roles: ['hr_admin'], strong: false });
    const res = await call('POST', '/api/v1/users/invitations', { cookie: weak.cookie, body });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('MFA_REQUIRED');
  });
});

describe('invitation end to end', () => {
  it('invite → emailed link → invitation info → accept → sign in with the emailed code', async () => {
    const email = `e2e-${uuidv7()}@example.test`;
    const invited = await json<Detail>(
      await call('POST', '/api/v1/users/invitations', {
        cookie: hr.cookie,
        body: { email, name: 'End To End', employeeId: await f.employee() },
      }),
    );
    const invitation = await eventually(async () => memoryMailer.lastTo(email));
    const token = tokenFrom(invitation.text) as string;

    const info = await call('GET', `/api/v1/auth/invitations/${token}`);
    expect(info.status).toBe(200);
    expect(await json(info)).toMatchObject({ companyName: 'Users Co' });

    const accepted = await call('POST', `/api/v1/auth/invitations/${token}/accept`);
    expect(accepted.status).toBe(200);
    const codeMail = await eventually(async () => {
      const m = memoryMailer.lastTo(email);
      return m && m !== invitation ? m : undefined;
    });
    const otp = /(\d{6})/.exec(codeMail.subject)?.[1];
    const signIn = await call('POST', '/api/v1/auth/sign-in/email-otp', { body: { email, otp } });
    expect(signIn.status).toBe(200);
    const cookie = mergeCookies('', signIn);
    const me = await json<{ user: { id: string; status: string }; roles: string[] }>(
      await call('GET', '/api/v1/auth/me', { cookie }),
    );
    expect(me.user).toMatchObject({ id: invited.id, status: 'active' });
    expect(me.roles).toEqual(['employee']);
    // The link works once.
    expect((await call('GET', `/api/v1/auth/invitations/${token}`)).status).toBe(404);
    expect((await auditFor(f.db, invited.id)).map((a) => a.action)).toEqual([
      'user.invited',
      'user.invitation_accepted',
      'user.signed_in',
    ]);
  });
});

describe('POST /users/{id}/invitations/resend', () => {
  it('revokes the old token and sends a new one', async () => {
    const email = `resend-${uuidv7()}@example.test`;
    const user = await json<Detail>(
      await call('POST', '/api/v1/users/invitations', {
        cookie: hr.cookie,
        body: { email, name: 'Re Send' },
      }),
    );
    const first = await eventually(async () => memoryMailer.lastTo(email));
    const oldToken = tokenFrom(first.text) as string;
    const res = await call('POST', `/api/v1/users/${user.id}/invitations/resend`, { cookie: hr.cookie });
    expect(res.status).toBe(200);
    const second = await eventually(async () => {
      const m = memoryMailer.lastTo(email);
      return m && m !== first ? m : undefined;
    });
    const newToken = tokenFrom(second.text) as string;
    expect(newToken).not.toBe(oldToken);
    expect((await call('GET', `/api/v1/auth/invitations/${oldToken}`)).status).toBe(404);
    expect((await call('GET', `/api/v1/auth/invitations/${newToken}`)).status).toBe(200);
    expect((await auditFor(f.db, user.id)).map((a) => a.action)).toContain('user.invitation_resent');
  });

  it('returns 409 for a user who is not invited', async () => {
    const active = await f.user();
    const res = await call('POST', `/api/v1/users/${active.userId}/invitations/resend`, {
      cookie: hr.cookie,
    });
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe('INVALID_TRANSITION');
  });

  it('returns 404 for another company’s user', async () => {
    const foreign = await other.user({ status: 'invited' });
    const res = await call('POST', `/api/v1/users/${foreign.userId}/invitations/resend`, {
      cookie: hr.cookie,
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /users/{id}', () => {
  it('returns the detail with enrolment state', async () => {
    const u = await f.user({ roles: ['auditor'] });
    const res = await call('GET', `/api/v1/users/${u.userId}`, { cookie: hr.cookie });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      id: u.userId,
      roles: ['auditor'],
      enrolment: { hasPasskey: false, hasTotp: false },
      invitation: null,
    });
  });

  it('returns 404 for another company’s user and 400 for a malformed id', async () => {
    const foreign = await other.user();
    expect((await call('GET', `/api/v1/users/${foreign.userId}`, { cookie: hr.cookie })).status).toBe(404);
    expect((await call('GET', '/api/v1/users/not-a-uuid', { cookie: hr.cookie })).status).toBe(400);
  });

  it('returns 403 to an employee', async () => {
    expect((await call('GET', `/api/v1/users/${hr.userId}`, { cookie: employee.cookie })).status).toBe(403);
  });
});

describe('account state changes', () => {
  it('suspends an active user, revoking sessions in the same transaction', async () => {
    const target = await f.signIn({ employee: true, strong: false });
    const { version } = await getUser(target.userId);
    const res = await call('POST', `/api/v1/users/${target.userId}/suspend`, {
      cookie: hr.cookie,
      body: { version, reason: 'Investigation' },
    });
    expect(res.status).toBe(200);
    expect((await json<Detail>(res)).status).toBe('suspended');
    const sessions = await f.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, target.userId));
    expect(sessions).toHaveLength(0);
    expect((await call('GET', '/api/v1/auth/me', { cookie: target.cookie })).status).toBe(401);
    const [audit] = await auditFor(f.db, target.userId);
    expect(audit).toMatchObject({ action: 'user.suspended', category: 'security' });
    expect(audit?.metadata).toMatchObject({ from: 'active', to: 'suspended', sessionsRevoked: 1 });
  });

  it('reactivates a suspended user and deactivates them', async () => {
    const target = await f.user({ status: 'suspended' });
    let { version } = await getUser(target.userId);
    const re = await call('POST', `/api/v1/users/${target.userId}/reactivate`, {
      cookie: hr.cookie,
      body: { version },
    });
    expect(re.status).toBe(200);
    ({ version } = await json<Detail>(re));
    const de = await call('POST', `/api/v1/users/${target.userId}/deactivate`, {
      cookie: hr.cookie,
      body: { version },
    });
    expect(de.status).toBe(200);
    expect((await json<Detail>(de)).status).toBe('deactivated');
    expect((await auditFor(f.db, target.userId)).map((a) => a.action)).toEqual([
      'user.reactivated',
      'user.deactivated',
    ]);
  });

  it('deactivating an invited user makes the invitation unusable', async () => {
    const email = `revoke-${uuidv7()}@example.test`;
    const user = await json<Detail>(
      await call('POST', '/api/v1/users/invitations', {
        cookie: hr.cookie,
        body: { email, name: 'Rev Oke' },
      }),
    );
    const token = tokenFrom((await eventually(async () => memoryMailer.lastTo(email))).text) as string;
    const res = await call('POST', `/api/v1/users/${user.id}/deactivate`, {
      cookie: hr.cookie,
      body: { version: user.version },
    });
    expect(res.status).toBe(200);
    expect((await call('GET', `/api/v1/auth/invitations/${token}`)).status).toBe(404);
  });

  it('refuses transitions the state machine does not list (409 INVALID_TRANSITION)', async () => {
    const target = await f.user({ status: 'deactivated' });
    const { version } = await getUser(target.userId);
    const res = await call('POST', `/api/v1/users/${target.userId}/reactivate`, {
      cookie: hr.cookie,
      body: { version },
    });
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe('INVALID_TRANSITION');
  });

  it('returns 409 VERSION_CONFLICT for a stale version', async () => {
    const target = await f.user();
    const { version } = await getUser(target.userId);
    const res = await call('POST', `/api/v1/users/${target.userId}/suspend`, {
      cookie: hr.cookie,
      body: { version: version + 1 },
    });
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe('VERSION_CONFLICT');
  });

  it('needs a fresh strong session (403 REAUTH_REQUIRED after 15 minutes)', async () => {
    const target = await f.user();
    const res = await call('POST', `/api/v1/users/${target.userId}/suspend`, {
      cookie: hr.cookie,
      body: { version: 1 },
      now: minutesFromNow(20),
    });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('REAUTH_REQUIRED');
  });

  it('refuses to act on your own account (SELF_APPROVAL_FORBIDDEN)', async () => {
    const res = await call('POST', `/api/v1/users/${hr.userId}/suspend`, {
      cookie: hr.cookie,
      body: { version: 1 },
    });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('SELF_APPROVAL_FORBIDDEN');
  });

  it('returns 404 for another company’s user, 400 for a missing version, 403 to an employee', async () => {
    const foreign = await other.user();
    expect(
      (
        await call('POST', `/api/v1/users/${foreign.userId}/suspend`, {
          cookie: hr.cookie,
          body: { version: 1 },
        })
      ).status,
    ).toBe(404);
    expect(
      (await call('POST', `/api/v1/users/${foreign.userId}/suspend`, { cookie: hr.cookie, body: {} })).status,
    ).toBe(400);
    expect(
      (
        await call('POST', `/api/v1/users/${hr.userId}/suspend`, {
          cookie: employee.cookie,
          body: { version: 1 },
        })
      ).status,
    ).toBe(403);
  });
});

describe('POST /users/{id}/reset-auth', () => {
  it('removes passkeys and TOTP, revokes sessions, emails the user and audits', async () => {
    const target = await f.signIn({ employee: true, strong: false });
    await f.db.insert(schema.passkeys).values({
      id: uuidv7(),
      publicKey: 'pk',
      userId: target.userId,
      credentialID: `cred-${uuidv7()}`,
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false,
    });
    await f.db
      .insert(schema.twoFactors)
      .values({ id: uuidv7(), secret: 'enc', backupCodes: 'enc', userId: target.userId, verified: true });
    const before = await getUser(target.userId);
    expect(before.enrolment).toEqual({ hasPasskey: true, hasTotp: true });

    const res = await call('POST', `/api/v1/users/${target.userId}/reset-auth`, {
      cookie: hr.cookie,
      body: { version: before.version },
    });
    expect(res.status).toBe(200);
    expect((await json<Detail>(res)).enrolment).toEqual({ hasPasskey: false, hasTotp: false });
    expect(
      await f.db.select().from(schema.sessions).where(eq(schema.sessions.userId, target.userId)),
    ).toEqual([]);
    const [audit] = await auditFor(f.db, target.userId);
    expect(audit).toMatchObject({ action: 'user.auth_reset', category: 'security' });
    expect(audit?.metadata).toMatchObject({ passkeysRemoved: 1, totpRemoved: true, sessionsRevoked: 1 });
    const outbox = (await outboxFor(f.db, f.companyId, ['email.auth_reset'])).filter(
      (m) => (m.payload as { userId: string }).userId === target.userId,
    );
    expect(outbox).toHaveLength(1);
    const mail = await eventually(async () => memoryMailer.lastTo(target.email));
    expect(mail.subject).toMatch(/reset/i);
  });

  it('refuses your own account and stale sessions', async () => {
    const self = await call('POST', `/api/v1/users/${hr.userId}/reset-auth`, {
      cookie: hr.cookie,
      body: { version: 1 },
    });
    expect((await json(self)).code).toBe('SELF_APPROVAL_FORBIDDEN');
    const target = await f.user();
    const stale = await call('POST', `/api/v1/users/${target.userId}/reset-auth`, {
      cookie: hr.cookie,
      body: { version: 1 },
      now: minutesFromNow(16),
    });
    expect((await json(stale)).code).toBe('REAUTH_REQUIRED');
  });

  it('returns 422 for an invited user and 404 for another company’s user', async () => {
    const invited = await f.user({ status: 'invited' });
    const res = await call('POST', `/api/v1/users/${invited.userId}/reset-auth`, {
      cookie: hr.cookie,
      body: { version: 1 },
    });
    expect(res.status).toBe(422);
    const foreign = await other.user();
    expect(
      (
        await call('POST', `/api/v1/users/${foreign.userId}/reset-auth`, {
          cookie: hr.cookie,
          body: { version: 1 },
        })
      ).status,
    ).toBe(404);
  });
});

describe('POST /users/{id}/roles', () => {
  it('replaces explicit roles and audits each grant and revocation', async () => {
    const target = await f.user({ roles: ['auditor'] });
    const { version } = await getUser(target.userId);
    const res = await call('POST', `/api/v1/users/${target.userId}/roles`, {
      cookie: admin.cookie,
      body: { roleCodes: ['hr_admin', 'director'], version },
    });
    expect(res.status).toBe(200);
    expect((await json<Detail>(res)).roles).toEqual(['director', 'hr_admin']);
    const audits = await auditFor(f.db, target.userId);
    expect(audits.map((a) => [a.action, (a.metadata as { roleCode: string }).roleCode]).sort()).toEqual([
      ['role.granted', 'director'],
      ['role.granted', 'hr_admin'],
      ['role.revoked', 'auditor'],
    ]);
  });

  it('applies on the next request of the affected user', async () => {
    const target = await f.signIn({ roles: ['auditor'] });
    const { version } = await getUser(target.userId);
    await call('POST', `/api/v1/users/${target.userId}/roles`, {
      cookie: admin.cookie,
      body: { roleCodes: [], version },
    });
    const me = await json<{ roles: string[] }>(
      await call('GET', '/api/v1/auth/me', { cookie: target.cookie }),
    );
    expect(me.roles).toEqual([]);
  });

  it('rejects derived roles (400), your own roles (403) and stale sessions (403)', async () => {
    const target = await f.user();
    const derived = await call('POST', `/api/v1/users/${target.userId}/roles`, {
      cookie: admin.cookie,
      body: { roleCodes: ['employee'], version: 1 },
    });
    expect(derived.status).toBe(400);
    const self = await call('POST', `/api/v1/users/${admin.userId}/roles`, {
      cookie: admin.cookie,
      body: { roleCodes: [], version: 1 },
    });
    expect((await json(self)).code).toBe('SELF_APPROVAL_FORBIDDEN');
    const stale = await call('POST', `/api/v1/users/${target.userId}/roles`, {
      cookie: admin.cookie,
      body: { roleCodes: [], version: 1 },
      now: minutesFromNow(20),
    });
    expect((await json(stale)).code).toBe('REAUTH_REQUIRED');
  });

  it('needs role.manage (403 for HR) and hides other companies’ users (404)', async () => {
    const target = await f.user();
    const res = await call('POST', `/api/v1/users/${target.userId}/roles`, {
      cookie: hr.cookie,
      body: { roleCodes: [], version: 1 },
    });
    expect(res.status).toBe(403);
    const foreign = await other.user();
    expect(
      (
        await call('POST', `/api/v1/users/${foreign.userId}/roles`, {
          cookie: admin.cookie,
          body: { roleCodes: [], version: 1 },
        })
      ).status,
    ).toBe(404);
  });
});

describe('roles and permissions', () => {
  type RoleDto = {
    id: string;
    code: string;
    isDerived: boolean;
    assignable: boolean;
    permissions: string[];
    version: number;
  };
  const roles = async (cookie: string) =>
    (await json<{ data: RoleDto[] }>(await call('GET', '/api/v1/roles', { cookie }))).data;

  it('lists roles with permissions to role.manage and settings.read holders', async () => {
    const list = await roles(admin.cookie);
    expect(list.map((r) => r.code)).toEqual(expect.arrayContaining(['system_admin', 'manager', 'employee']));
    const manager = list.find((r) => r.code === 'manager');
    expect(manager).toMatchObject({ isDerived: true, assignable: false });
    expect(manager?.permissions).toContain('leave.request.review.team');
    const auditor = await f.signIn({ roles: ['auditor'] });
    expect((await call('GET', '/api/v1/roles', { cookie: auditor.cookie })).status).toBe(200);
    expect((await call('GET', '/api/v1/roles', { cookie: employee.cookie })).status).toBe(403);
  });

  it('changes a role’s permissions and audits role.permissions_changed', async () => {
    const director = (await roles(admin.cookie)).find((r) => r.code === 'director') as RoleDto;
    const next = [...director.permissions.filter((p) => p !== 'report.hr'), 'report.team'];
    const res = await call('PATCH', `/api/v1/roles/${director.id}`, {
      cookie: admin.cookie,
      body: { permissions: next, description: 'Top management', version: director.version },
    });
    expect(res.status).toBe(200);
    const updated = await json<RoleDto>(res);
    expect(updated.permissions).toContain('report.team');
    expect(updated.permissions).not.toContain('report.hr');
    expect(updated.version).toBe(director.version + 1);
    const audits = await auditFor(f.db, director.id);
    expect(audits.map((a) => a.action).sort()).toEqual(['role.permissions_changed', 'role.updated']);
    expect(audits.find((a) => a.action === 'role.permissions_changed')?.metadata).toEqual({
      roleCode: 'director',
      added: ['report.team'],
      removed: ['report.hr'],
    });
  });

  it('allows editing a derived role’s permissions', async () => {
    const emp = (await roles(admin.cookie)).find((r) => r.code === 'employee') as RoleDto;
    const res = await call('PATCH', `/api/v1/roles/${emp.id}`, {
      cookie: admin.cookie,
      body: { permissions: emp.permissions, name: 'Staff', version: emp.version },
    });
    expect(res.status).toBe(200);
    expect((await json<{ name: string }>(res)).name).toBe('Staff');
  });

  it('refuses to remove role.manage from a role the caller holds (422)', async () => {
    const sys = (await roles(admin.cookie)).find((r) => r.code === 'system_admin') as RoleDto;
    const res = await call('PATCH', `/api/v1/roles/${sys.id}`, {
      cookie: admin.cookie,
      body: { permissions: sys.permissions.filter((p) => p !== 'role.manage'), version: sys.version },
    });
    expect(res.status).toBe(422);
  });

  it('validates permission codes (400), needs fresh auth (403) and hides other companies’ roles (404)', async () => {
    const list = await roles(admin.cookie);
    const auditorRole = list.find((r) => r.code === 'auditor') as RoleDto;
    const bad = await call('PATCH', `/api/v1/roles/${auditorRole.id}`, {
      cookie: admin.cookie,
      body: { permissions: ['payroll.everything'], version: auditorRole.version },
    });
    expect(bad.status).toBe(400);
    const stale = await call('PATCH', `/api/v1/roles/${auditorRole.id}`, {
      cookie: admin.cookie,
      body: { name: 'X', version: auditorRole.version },
      now: minutesFromNow(20),
    });
    expect((await json(stale)).code).toBe('REAUTH_REQUIRED');
    const [foreignRole] = await other.db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(and(eq(schema.roles.companyId, other.companyId), eq(schema.roles.code, 'auditor')));
    const res = await call('PATCH', `/api/v1/roles/${foreignRole?.id}`, {
      cookie: admin.cookie,
      body: { name: 'X', version: 1 },
    });
    expect(res.status).toBe(404);
    expect(
      (
        await call('PATCH', `/api/v1/roles/${auditorRole.id}`, {
          cookie: hr.cookie,
          body: { name: 'X', version: auditorRole.version },
        })
      ).status,
    ).toBe(403);
  });

  it('lists the permission catalogue to role.manage only', async () => {
    const res = await call('GET', '/api/v1/permissions', { cookie: admin.cookie });
    expect(res.status).toBe(200);
    const codes = (await json<{ data: { code: string }[] }>(res)).data.map((p) => p.code);
    expect(codes).toContain('user.manage');
    expect((await call('GET', '/api/v1/permissions', { cookie: hr.cookie })).status).toBe(403);
  });
});

describe('TOTP enrolment and step-up', () => {
  it('enables TOTP through Better Auth, steps up with a code, and /auth/me shows a strong session', async () => {
    const u = await f.user({ employee: true });
    let cookie = await login(u.userId, false);
    const enable = await call('POST', '/api/v1/auth/two-factor/enable', { cookie, body: {} });
    expect(enable.status).toBe(200);
    cookie = mergeCookies(cookie, enable);
    const { totpURI } = await json<{ totpURI: string }>(enable);
    const encoded = new URL(totpURI).searchParams.get('secret') as string;
    const secret = new TextDecoder().decode(base32.decode(encoded));
    const code = await createOTP(secret, { digits: 6, period: 30 }).totp();

    const step = await call('POST', '/api/v1/auth/step-up/totp', { cookie, body: { code } });
    expect(step.status).toBe(200);
    cookie = mergeCookies(cookie, step);
    const me = await json<{ session: { strongAuth: boolean }; enrolment: { hasTotp: boolean } }>(
      await call('GET', '/api/v1/auth/me', { cookie }),
    );
    expect(me.session.strongAuth).toBe(true);
    expect(me.enrolment.hasTotp).toBe(true);
    expect((await auditFor(f.db, u.userId)).map((a) => a.action)).toContain('user.step_up_completed');
  });

  it('rejects a wrong code', async () => {
    const u = await f.user({ employee: true });
    const cookie = await login(u.userId, false);
    await call('POST', '/api/v1/auth/two-factor/enable', { cookie, body: {} });
    const res = await call('POST', '/api/v1/auth/step-up/totp', { cookie, body: { code: '000000' } });
    expect(res.status).toBe(401);
  });
});
