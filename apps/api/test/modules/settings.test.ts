import { schema } from '@hrm/db';
import { and, desc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { call, type Fixture, json, setupCompany, type TestUser } from '../harness';

let f: Fixture;
let hr: TestUser;
let payroll: TestUser;
let admin: TestUser;
let employee: TestUser;
let other: Fixture;

type Setting = { key: string; scope: string; value: unknown; version: number; editable: boolean };
type Groups = Partial<Record<'technical' | 'hr' | 'payroll', Setting[]>>;

beforeAll(async () => {
  f = await setupCompany('Settings Co');
  hr = await f.signIn({ roles: ['hr_admin'] });
  payroll = await f.signIn({ roles: ['payroll_officer'] });
  admin = await f.signIn({ roles: ['system_admin'] });
  employee = await f.signIn({ employee: true, strong: false });
  other = await setupCompany('Other Settings Co');
});

const read = async (cookie: string) => json<Groups>(await call('GET', '/api/v1/settings', { cookie }));
const find = (g: Groups, key: string) =>
  Object.values(g)
    .flat()
    .find((s) => s?.key === key) as Setting;

const history = (companyId: string, key: string) =>
  f.db
    .select()
    .from(schema.settingsHistory)
    .where(and(eq(schema.settingsHistory.companyId, companyId), eq(schema.settingsHistory.key, key)))
    .orderBy(desc(schema.settingsHistory.changedAt));

const settingAudits = (companyId: string) =>
  f.db
    .select()
    .from(schema.auditLogs)
    .where(and(eq(schema.auditLogs.companyId, companyId), eq(schema.auditLogs.action, 'settings.changed')))
    .orderBy(schema.auditLogs.occurredAt);

describe('GET /settings', () => {
  it('returns every scope to settings.read holders, editable only where they manage', async () => {
    const g = await read(hr.cookie);
    expect(Object.keys(g).sort()).toEqual(['hr', 'payroll', 'technical']);
    expect(find(g, 'attendance.correction_window_days')).toMatchObject({
      scope: 'hr',
      value: 7,
      editable: true,
    });
    expect(find(g, 'payroll.allow_self_approval')).toMatchObject({ scope: 'payroll', editable: false });
    expect(find(g, 'documents.retention_days.identity').value).toBeNull();
  });

  it('returns 403 to an employee', async () => {
    const res = await call('GET', '/api/v1/settings', { cookie: employee.cookie });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /settings', () => {
  it('updates an HR key, bumps its version, writes history and a business audit row', async () => {
    const before = find(await read(hr.cookie), 'attendance.correction_window_days');
    const res = await call('PATCH', '/api/v1/settings', {
      cookie: hr.cookie,
      body: { changes: { 'attendance.correction_window_days': { value: 10, version: before.version } } },
    });
    expect(res.status).toBe(200);
    const after = find(await json<Groups>(res), 'attendance.correction_window_days');
    expect(after).toMatchObject({ value: 10, version: before.version + 1 });
    const [h] = await history(f.companyId, 'attendance.correction_window_days');
    expect(h).toMatchObject({ oldValue: 7, newValue: 10, changedBy: hr.userId });
    const audits = await settingAudits(f.companyId);
    expect(audits.at(-1)).toMatchObject({ category: 'business', actorUserId: hr.userId });
    expect(audits.at(-1)?.metadata).toEqual({
      key: 'attendance.correction_window_days',
      scope: 'hr',
      from: 7,
      to: 10,
    });
  });

  it('stores JSON null and records it in history', async () => {
    const key = 'documents.retention_days.contract';
    const v1 = find(await read(hr.cookie), key);
    const set = await call('PATCH', '/api/v1/settings', {
      cookie: hr.cookie,
      body: { changes: { [key]: { value: 3650, version: v1.version } } },
    });
    const v2 = find(await json<Groups>(set), key);
    const back = await call('PATCH', '/api/v1/settings', {
      cookie: hr.cookie,
      body: { changes: { [key]: { value: null, version: v2.version } } },
    });
    expect(back.status).toBe(200);
    expect(find(await json<Groups>(back), key).value).toBeNull();
    const [latest] = await history(f.companyId, key);
    expect(latest).toMatchObject({ oldValue: 3650, newValue: null });
  });

  it('categorises payroll and technical keys by scope', async () => {
    const p = find(await read(payroll.cookie), 'payroll.anomaly_threshold_percent');
    expect(
      (
        await call('PATCH', '/api/v1/settings', {
          cookie: payroll.cookie,
          body: { changes: { 'payroll.anomaly_threshold_percent': { value: 25, version: p.version } } },
        })
      ).status,
    ).toBe(200);
    const t = find(await read(admin.cookie), 'documents.max_upload_mb');
    expect(
      (
        await call('PATCH', '/api/v1/settings', {
          cookie: admin.cookie,
          body: { changes: { 'documents.max_upload_mb': { value: 5, version: t.version } } },
        })
      ).status,
    ).toBe(200);
    const audits = await settingAudits(f.companyId);
    const byKey = (k: string) => audits.find((a) => (a.metadata as { key: string }).key === k)?.category;
    expect(byKey('payroll.anomaly_threshold_percent')).toBe('payroll');
    expect(byKey('documents.max_upload_mb')).toBe('technical');
  });

  it('rejects a key outside the caller’s scopes with 403 and changes nothing', async () => {
    const g = await read(hr.cookie);
    const hrKey = find(g, 'approvals.hide_reviewer');
    const res = await call('PATCH', '/api/v1/settings', {
      cookie: hr.cookie,
      body: {
        changes: {
          'approvals.hide_reviewer': { value: true, version: hrKey.version },
          'payroll.allow_self_approval': { value: false, version: 1 },
        },
      },
    });
    expect(res.status).toBe(403);
    expect(find(await read(hr.cookie), 'approvals.hide_reviewer').value).toBe(false);
  });

  it('validates each value with its catalogue schema (400 with the key path)', async () => {
    const res = await call('PATCH', '/api/v1/settings', {
      cookie: hr.cookie,
      body: {
        changes: {
          'attendance.checkout_window_hours': { value: 48, version: 1 },
          'no.such.key': { value: 1, version: 0 },
        },
      },
    });
    expect(res.status).toBe(400);
    const paths = (await json<{ errors: { path: string }[] }>(res)).errors.map((e) => e.path).sort();
    expect(paths).toEqual(['/changes/attendance.checkout_window_hours/value', '/changes/no.such.key']);
    expect(
      (await call('PATCH', '/api/v1/settings', { cookie: hr.cookie, body: { changes: {} } })).status,
    ).toBe(400);
  });

  it('returns 409 VERSION_CONFLICT for a stale per-key version', async () => {
    const s = find(await read(hr.cookie), 'leave.calendar.visible_to_team');
    const res = await call('PATCH', '/api/v1/settings', {
      cookie: hr.cookie,
      body: { changes: { 'leave.calendar.visible_to_team': { value: true, version: s.version + 5 } } },
    });
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe('VERSION_CONFLICT');
  });

  it('never touches another company’s settings', async () => {
    const before = await other.db
      .select()
      .from(schema.settings)
      .where(
        and(
          eq(schema.settings.companyId, other.companyId),
          eq(schema.settings.key, 'employees.code_padding'),
        ),
      );
    const s = find(await read(hr.cookie), 'employees.code_padding');
    await call('PATCH', '/api/v1/settings', {
      cookie: hr.cookie,
      body: { changes: { 'employees.code_padding': { value: 6, version: s.version } } },
    });
    const after = await other.db
      .select()
      .from(schema.settings)
      .where(
        and(
          eq(schema.settings.companyId, other.companyId),
          eq(schema.settings.key, 'employees.code_padding'),
        ),
      );
    expect(after[0]?.value).toEqual(before[0]?.value);
  });

  it('returns 403 to an employee and MFA_REQUIRED to a weak privileged session', async () => {
    const body = { changes: { 'approvals.hide_reviewer': { value: true, version: 1 } } };
    expect((await call('PATCH', '/api/v1/settings', { cookie: employee.cookie, body })).status).toBe(403);
    const weak = await f.signIn({ roles: ['hr_admin'], strong: false });
    const res = await call('PATCH', '/api/v1/settings', { cookie: weak.cookie, body });
    expect((await json(res)).code).toBe('MFA_REQUIRED');
  });
});
