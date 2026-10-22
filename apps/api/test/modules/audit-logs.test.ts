import { schema, uuidv7 } from '@hrm/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { call, type Fixture, json, setupCompany, type TestUser } from '../harness';

let f: Fixture;
let hr: TestUser;
let payroll: TestUser;
let admin: TestUser;
let employee: TestUser;
let other: Fixture;
const entityId = uuidv7();

type Entry = {
  id: string;
  action: string;
  category: string;
  actorName: string | null;
  entityId: string | null;
  metadata?: Record<string, unknown>;
};
type Page = { data: Entry[]; page: { totalItems: number; totalPages: number } };

// Fixed dates far from "now", so rows written by sign-ins in this file do not interfere.
const DAY = '2026-03-10';
const at = (time: string) => new Date(`${DAY}T${time}+06:00`);

beforeAll(async () => {
  f = await setupCompany('Audit Co');
  hr = await f.signIn({ roles: ['hr_admin'], name: 'Hasina HR' });
  payroll = await f.signIn({ roles: ['payroll_officer'] });
  admin = await f.signIn({ roles: ['system_admin'] });
  employee = await f.signIn({ employee: true, strong: false });
  other = await setupCompany('Other Audit Co');
  const row = (
    companyId: string,
    action: string,
    category: string,
    occurredAt: Date,
    actorUserId: string | null = hr.userId,
  ) => ({
    id: uuidv7(),
    companyId,
    occurredAt,
    actorUserId,
    actorType: actorUserId ? 'user' : 'system',
    action,
    category,
    entityType: 'thing',
    entityId,
    metadata: { detail: action },
  });
  await f.db.insert(schema.auditLogs).values([
    row(f.companyId, 'department.created', 'business', at('09:00')),
    row(f.companyId, 'payroll_run.created', 'payroll', at('10:00')),
    row(f.companyId, 'payroll_run.approved', 'payroll', at('11:00')),
    row(f.companyId, 'role.granted', 'security', at('12:00')),
    row(f.companyId, 'job.failed', 'technical', at('13:00'), null),
    // 00:30 Dhaka on the next day is still the previous UTC day: it must fall outside a one-day range.
    row(f.companyId, 'department.updated', 'business', new Date('2026-03-11T00:30:00+06:00')),
    row(other.companyId, 'department.created', 'business', at('09:30'), null),
  ]);
});

const list = (cookie: string, query: string) => call('GET', `/api/v1/audit-logs?${query}`, { cookie });
const base = `from=${DAY}&to=${DAY}`;

describe('GET /audit-logs', () => {
  it('shows audit.read.all business, payroll and security events with metadata and actor names', async () => {
    const res = await list(hr.cookie, base);
    expect(res.status).toBe(200);
    const body = await json<Page>(res);
    expect(body.data.map((e) => e.action)).toEqual([
      'role.granted',
      'payroll_run.approved',
      'payroll_run.created',
      'department.created',
    ]);
    expect(body.data[0]).toMatchObject({ actorName: 'Hasina HR', metadata: { detail: 'role.granted' } });
  });

  it('limits audit.read.payroll to payroll events', async () => {
    const body = await json<Page>(await list(payroll.cookie, base));
    expect(body.data.map((e) => e.category)).toEqual(['payroll', 'payroll']);
  });

  it('shows audit.read.technical technical and security events, hiding security metadata', async () => {
    const body = await json<Page>(await list(admin.cookie, base));
    expect(body.data.map((e) => e.action)).toEqual(['job.failed', 'role.granted']);
    expect(body.data[0]?.metadata).toEqual({ detail: 'job.failed' });
    expect(body.data[0]?.actorName).toBeNull();
    expect(body.data[1]).not.toHaveProperty('metadata');
  });

  it('filters by action prefix, entity, actor and category', async () => {
    const prefix = await json<Page>(await list(hr.cookie, `${base}&action=payroll_run.`));
    expect(prefix.data.map((e) => e.action)).toEqual(['payroll_run.approved', 'payroll_run.created']);
    const byEntity = await json<Page>(await list(hr.cookie, `${base}&entityType=thing&entityId=${entityId}`));
    expect(byEntity.data).toHaveLength(4);
    const byActor = await json<Page>(await list(admin.cookie, `${base}&actorUserId=${hr.userId}`));
    expect(byActor.data.map((e) => e.action)).toEqual(['role.granted']);
    const byCategory = await json<Page>(await list(hr.cookie, `${base}&category=security`));
    expect(byCategory.data.map((e) => e.action)).toEqual(['role.granted']);
    const notVisible = await json<Page>(await list(payroll.cookie, `${base}&category=security`));
    expect(notVisible.data).toEqual([]);
  });

  it('includes the whole Asia/Dhaka day range and paginates', async () => {
    const twoDays = await json<Page>(await list(hr.cookie, `from=${DAY}&to=2026-03-11&pageSize=2&page=1`));
    expect(twoDays.page).toMatchObject({ totalItems: 5, totalPages: 3 });
    expect(twoDays.data.map((e) => e.action)).toEqual(['department.updated', 'role.granted']);
  });

  it('never shows another company’s events', async () => {
    const body = await json<Page>(await list(hr.cookie, `${base}&action=department.`));
    expect(body.data).toHaveLength(1);
  });

  it('requires from and to, at most 366 days apart, in order (400)', async () => {
    expect((await list(hr.cookie, `from=${DAY}`)).status).toBe(400);
    expect((await list(hr.cookie, 'from=2025-01-01&to=2026-01-03')).status).toBe(400);
    expect((await list(hr.cookie, 'from=2025-01-01&to=2026-01-01')).status).toBe(200);
    const reversed = await list(hr.cookie, 'from=2026-03-10&to=2026-03-01');
    expect(reversed.status).toBe(400);
    expect((await json<{ errors: { path: string }[] }>(reversed)).errors[0]?.path).toBe('query/to');
  });

  it('returns 403 to an employee and 401 without a session', async () => {
    expect((await list(employee.cookie, base)).status).toBe(403);
    expect((await call('GET', `/api/v1/audit-logs?${base}`)).status).toBe(401);
  });
});
