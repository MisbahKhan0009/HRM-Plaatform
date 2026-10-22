import { schema } from '@hrm/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { memoryMailer } from '../src/lib/mailer';
import { call, eventually, type Fixture, json, login, setupCompany } from './harness';

let f: Fixture;
beforeAll(async () => {
  f = await setupCompany('Auth Co');
});

describe('GET /auth/me', () => {
  it('returns 401 without a session', async () => {
    const res = await call('GET', '/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe('UNAUTHENTICATED');
  });

  it('returns derived employee permissions for a plain employee', async () => {
    const u = await f.signIn({ employee: true, strong: false });
    const res = await call('GET', '/api/v1/auth/me', { cookie: u.cookie });
    expect(res.status).toBe(200);
    const me = await json<{
      roles: string[];
      permissions: string[];
      employee: { id: string } | null;
      session: { mfaRequired: boolean };
    }>(res);
    expect(me.roles).toEqual(['employee']);
    expect(me.permissions).toContain('leave.request.own');
    expect(me.permissions).not.toContain('employee.read.all');
    expect(me.employee?.id).toBe(u.employeeId);
    expect(me.session.mfaRequired).toBe(false);
  });

  it('derives the manager role from direct reports', async () => {
    const m = await f.signIn({ employee: true, strong: false });
    await f.employee({ managerId: m.employeeId });
    const me = await json<{ roles: string[]; permissions: string[] }>(
      await call('GET', '/api/v1/auth/me', { cookie: m.cookie }),
    );
    expect(me.roles.sort()).toEqual(['employee', 'manager']);
    expect(me.permissions).toContain('leave.request.review.team');
  });

  it('shows a weak privileged session only non-privileged permissions', async () => {
    const hr = await f.signIn({ roles: ['hr_admin'], employee: true, strong: false });
    const me = await json<{ permissions: string[]; session: { mfaRequired: boolean; strongAuth: boolean } }>(
      await call('GET', '/api/v1/auth/me', { cookie: hr.cookie }),
    );
    expect(me.session).toMatchObject({ mfaRequired: true, strongAuth: false });
    expect(me.permissions).not.toContain('employee.manage');
    expect(me.permissions).toContain('leave.request.own');
  });
});

describe('session rules', () => {
  it('returns 403 MFA_REQUIRED to a weak privileged session on business routes', async () => {
    const hr = await f.signIn({ roles: ['hr_admin'], strong: false });
    const res = await call('GET', '/api/v1/employees', { cookie: hr.cookie });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('MFA_REQUIRED');
    // Identity and preferences stay reachable so the UI can run step-up.
    expect(
      (await call('PATCH', '/api/v1/auth/me/preferences', { cookie: hr.cookie, body: { theme: 'paper' } }))
        .status,
    ).toBe(200);
  });

  it('rejects a suspended user with ACCOUNT_SUSPENDED and deletes their sessions', async () => {
    const u = await f.signIn({ employee: true, strong: false });
    await f.db.update(schema.users).set({ status: 'suspended' }).where(eq(schema.users.id, u.userId));
    const res = await call('GET', '/api/v1/auth/me', { cookie: u.cookie });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('ACCOUNT_SUSPENDED');
    const left = await f.db.select().from(schema.sessions).where(eq(schema.sessions.userId, u.userId));
    expect(left).toHaveLength(0);
  });

  it('signs out after the idle timeout', async () => {
    const u = await f.signIn({ employee: true, strong: false });
    const later = new Date(Date.now() + 9 * 3_600_000).toISOString();
    const res = await call('GET', '/api/v1/auth/me', { cookie: u.cookie, now: later });
    expect(res.status).toBe(401);
  });

  it('rejects state changes from another origin', async () => {
    const u = await f.signIn({ employee: true, strong: false });
    const res = await call('PATCH', '/api/v1/auth/me/preferences', {
      cookie: u.cookie,
      body: { theme: 'paper' },
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('CSRF_ORIGIN_MISMATCH');
  });
});

describe('PATCH /auth/me/preferences', () => {
  it('stores the theme (D-040)', async () => {
    const u = await f.signIn({ employee: true, strong: false });
    const res = await call('PATCH', '/api/v1/auth/me/preferences', {
      cookie: u.cookie,
      body: { theme: 'paper' },
    });
    expect(res.status).toBe(200);
    expect((await json<{ user: { theme: string } }>(res)).user.theme).toBe('paper');
    const again = await json<{ user: { theme: string } }>(
      await call('GET', '/api/v1/auth/me', { cookie: u.cookie }),
    );
    expect(again.user.theme).toBe('paper');
  });

  it('rejects unknown fields with VALIDATION_FAILED', async () => {
    const u = await f.signIn({ employee: true, strong: false });
    const res = await call('PATCH', '/api/v1/auth/me/preferences', {
      cookie: u.cookie,
      body: { theme: 'neon' },
    });
    expect(res.status).toBe(400);
    const body = await json<{ code: string; errors: { path: string }[] }>(res);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.errors[0]?.path).toBe('/theme');
  });
});

describe('email code sign-in', () => {
  it('signs an active user in with an emailed code, creating a weak session and an audit row', async () => {
    const u = await f.user({ employee: true });
    const send = await call('POST', '/api/v1/auth/email-otp/send-verification-otp', {
      body: { email: u.email, type: 'sign-in' },
    });
    expect(send.status).toBe(200);
    const mail = await eventually(async () => memoryMailer.lastTo(u.email));
    const code = /(\d{6})/.exec(mail.subject)?.[1];
    expect(code).toBeDefined();
    const res = await call('POST', '/api/v1/auth/sign-in/email-otp', { body: { email: u.email, otp: code } });
    expect(res.status).toBe(200);
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const me = await json<{ session: { authMethod: string; strongAuth: boolean } }>(
      await call('GET', '/api/v1/auth/me', { cookie }),
    );
    expect(me.session).toMatchObject({ authMethod: 'email_otp', strongAuth: false });
    const audits = await f.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, u.userId));
    expect(audits.map((a) => a.action)).toContain('user.signed_in');
  });

  it('sends no code to a suspended user but still answers 200 (no account enumeration)', async () => {
    const u = await f.user({ status: 'suspended' });
    const res = await call('POST', '/api/v1/auth/email-otp/send-verification-otp', {
      body: { email: u.email, type: 'sign-in' },
    });
    expect(res.status).toBe(200);
    expect(memoryMailer.lastTo(u.email)).toBeUndefined();
  });
});

describe('test login route', () => {
  it('works in the test environment', async () => {
    const u = await f.user();
    expect(await login(u.userId, false)).toContain('hrm.session_token=');
  });
});
