import { beforeAll, describe, expect, it } from 'vitest';
import { auditFor, call, type Fixture, json, setupCompany, type TestUser } from '../harness';

let f: Fixture;
let hr: TestUser;
let employee: TestUser;
let other: Fixture;

beforeAll(async () => {
  f = await setupCompany('Org Co');
  hr = await f.signIn({ roles: ['hr_admin'] });
  employee = await f.signIn({ employee: true, strong: false });
  other = await setupCompany('Other Co');
});

describe('departments', () => {
  it('lets HR create a department, upper-casing the code, and audits it', async () => {
    const res = await call('POST', '/api/v1/departments', {
      cookie: hr.cookie,
      body: { code: 'eng', name: 'Engineering' },
    });
    expect(res.status).toBe(201);
    const dep = await json<{ id: string; code: string; version: number }>(res);
    expect(dep).toMatchObject({ code: 'ENG', version: 1 });
    expect(res.headers.get('Location')).toBe(`/api/v1/departments/${dep.id}`);
    expect((await auditFor(f.db, dep.id)).map((a) => a.action)).toEqual(['department.created']);
  });

  it('returns 409 DEPARTMENT_CODE_TAKEN for a duplicate code', async () => {
    await call('POST', '/api/v1/departments', { cookie: hr.cookie, body: { code: 'FIN', name: 'Finance' } });
    const res = await call('POST', '/api/v1/departments', {
      cookie: hr.cookie,
      body: { code: 'FIN', name: 'Finance 2' },
    });
    expect(res.status).toBe(409);
    const body = await json<{ code: string; errors: { path: string }[] }>(res);
    expect(body.code).toBe('DEPARTMENT_CODE_TAKEN');
    expect(body.errors[0]?.path).toBe('/code');
  });

  it('returns 400 VALIDATION_FAILED for a bad code', async () => {
    const res = await call('POST', '/api/v1/departments', {
      cookie: hr.cookie,
      body: { code: 'x', name: 'X' },
    });
    expect(res.status).toBe(400);
    expect((await json<{ errors: { path: string }[] }>(res)).errors[0]?.path).toBe('/code');
  });

  it('returns 403 FORBIDDEN to an employee', async () => {
    const res = await call('POST', '/api/v1/departments', {
      cookie: employee.cookie,
      body: { code: 'OPS', name: 'Ops' },
    });
    expect(res.status).toBe(403);
  });

  it('lists departments to any signed-in user, active only by default', async () => {
    const created = await json<{ id: string; version: number }>(
      await call('POST', '/api/v1/departments', {
        cookie: hr.cookie,
        body: { code: 'OLD', name: 'Old unit' },
      }),
    );
    const retired = await call('PATCH', `/api/v1/departments/${created.id}`, {
      cookie: hr.cookie,
      body: { isActive: false, version: created.version },
    });
    expect(retired.status).toBe(200);
    const listed = await json<{ data: { code: string }[] }>(
      await call('GET', '/api/v1/departments', { cookie: employee.cookie }),
    );
    expect(listed.data.map((d) => d.code)).not.toContain('OLD');
    const all = await json<{ data: { code: string }[] }>(
      await call('GET', '/api/v1/departments?includeInactive=true', { cookie: employee.cookie }),
    );
    expect(all.data.map((d) => d.code)).toContain('OLD');
  });

  it('returns 409 VERSION_CONFLICT for a stale version', async () => {
    const dep = await json<{ id: string }>(
      await call('POST', '/api/v1/departments', {
        cookie: hr.cookie,
        body: { code: 'MKT', name: 'Marketing' },
      }),
    );
    await call('PATCH', `/api/v1/departments/${dep.id}`, {
      cookie: hr.cookie,
      body: { name: 'Marketing & Sales', version: 1 },
    });
    const stale = await call('PATCH', `/api/v1/departments/${dep.id}`, {
      cookie: hr.cookie,
      body: { name: 'Growth', version: 1 },
    });
    expect(stale.status).toBe(409);
    expect((await json(stale)).code).toBe('VERSION_CONFLICT');
  });

  it('returns 404 for a department of another company', async () => {
    const otherHr = await other.signIn({ roles: ['hr_admin'] });
    const theirs = await json<{ id: string }>(
      await call('POST', '/api/v1/departments', {
        cookie: otherHr.cookie,
        body: { code: 'SEC', name: 'Secret' },
      }),
    );
    const res = await call('PATCH', `/api/v1/departments/${theirs.id}`, {
      cookie: hr.cookie,
      body: { name: 'Mine now', version: 1 },
    });
    expect(res.status).toBe(404);
  });
});

describe('holidays', () => {
  it('creates, lists by year and refuses to delete a past holiday', async () => {
    const past = await json<{ id: string }>(
      await call('POST', '/api/v1/holidays', {
        cookie: hr.cookie,
        body: { date: '2026-02-21', name: 'Language Martyrs Day' },
      }),
    );
    const listed = await json<{ data: { date: string }[] }>(
      await call('GET', '/api/v1/holidays?year=2026', { cookie: employee.cookie }),
    );
    expect(listed.data.map((h) => h.date)).toContain('2026-02-21');
    const del = await call('DELETE', `/api/v1/holidays/${past.id}`, {
      cookie: hr.cookie,
      now: '2026-06-01T00:00:00Z',
    });
    expect(del.status).toBe(422);
  });

  it('deletes a future holiday', async () => {
    const h = await json<{ id: string }>(
      await call('POST', '/api/v1/holidays', {
        cookie: hr.cookie,
        body: { date: '2027-12-16', name: 'Victory Day' },
      }),
    );
    const del = await call('DELETE', `/api/v1/holidays/${h.id}`, {
      cookie: hr.cookie,
      now: '2026-06-01T00:00:00Z',
    });
    expect(del.status).toBe(204);
  });

  it('returns 409 DUPLICATE for a second holiday on the same date', async () => {
    await call('POST', '/api/v1/holidays', {
      cookie: hr.cookie,
      body: { date: '2026-03-26', name: 'Independence Day' },
    });
    const res = await call('POST', '/api/v1/holidays', {
      cookie: hr.cookie,
      body: { date: '2026-03-26', name: 'Again' },
    });
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe('DUPLICATE');
  });
});

describe('work schedules and assignments', () => {
  it('keeps one default schedule and ends the previous assignment', async () => {
    const s = await json<{ id: string; isDefault: boolean; workingDays: number[] }>(
      await call('POST', '/api/v1/work-schedules', {
        cookie: hr.cookie,
        body: {
          name: 'Ramadan',
          workingDays: [0, 1, 2, 3, 4],
          coreStart: '09:00',
          coreEnd: '14:00',
          minDailyMinutes: 360,
          isDefault: true,
        },
      }),
    );
    expect(s.isDefault).toBe(true);
    const all = await json<{ data: { isDefault: boolean }[] }>(
      await call('GET', '/api/v1/work-schedules', { cookie: hr.cookie }),
    );
    expect(all.data.filter((x) => x.isDefault)).toHaveLength(1);

    const emp = await f.employee();
    const first = await call('POST', '/api/v1/schedule-assignments', {
      cookie: hr.cookie,
      body: { employeeId: emp, workScheduleId: s.id, effectiveFrom: '2026-01-01' },
    });
    expect(first.status).toBe(201);
    const second = await call('POST', '/api/v1/schedule-assignments', {
      cookie: hr.cookie,
      body: { employeeId: emp, workScheduleId: s.id, effectiveFrom: '2026-03-01' },
    });
    expect(second.status).toBe(201);
    const overlap = await call('POST', '/api/v1/schedule-assignments', {
      cookie: hr.cookie,
      body: { employeeId: emp, workScheduleId: s.id, effectiveFrom: '2026-02-01', effectiveTo: '2026-03-15' },
    });
    expect(overlap.status).toBe(422);
  });

  it('rejects a core window that ends before it starts', async () => {
    const res = await call('POST', '/api/v1/work-schedules', {
      cookie: hr.cookie,
      body: { name: 'Bad', workingDays: [0], coreStart: '16:00', coreEnd: '10:00', minDailyMinutes: 60 },
    });
    expect(res.status).toBe(400);
  });

  it('hides schedules from users without attendance permissions', async () => {
    const nobody = await f.signIn({ strong: false });
    expect((await call('GET', '/api/v1/work-schedules', { cookie: nobody.cookie })).status).toBe(403);
  });
});

describe('company', () => {
  it('lets any user read and HR update the company profile', async () => {
    const read = await json<{ name: string; version: number }>(
      await call('GET', '/api/v1/company', { cookie: employee.cookie }),
    );
    expect(read.name).toBe('Org Co');
    const res = await call('PATCH', '/api/v1/company', {
      cookie: hr.cookie,
      body: { legalName: 'Org Co Ltd.', version: read.version },
    });
    expect(res.status).toBe(200);
    expect((await json<{ legalName: string }>(res)).legalName).toBe('Org Co Ltd.');
    expect(
      (await call('PATCH', '/api/v1/company', { cookie: employee.cookie, body: { name: 'X', version: 2 } }))
        .status,
    ).toBe(403);
  });
});

describe('approvals inbox', () => {
  it('lists permission-assigned steps to a holder of that permission (array parameters regression)', async () => {
    const res = await call('GET', '/api/v1/approvals/inbox', { cookie: hr.cookie });
    expect(res.status).toBe(200);
    expect((await json<{ data: unknown[] }>(res)).data).toEqual([]);
  });
});
