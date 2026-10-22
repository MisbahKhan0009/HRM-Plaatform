import { schema } from '@hrm/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditFor, call, type Fixture, json, setupCompany, type TestUser } from '../harness';

type Employee = {
  id: string;
  view: string;
  employeeCode: string;
  status: string;
  version: number;
  manager: { id: string } | null;
  department: { id: string; name: string } | null;
  joiningDate: string | null;
  probationEndDate?: string | null;
  separationDate?: string | null;
  dateOfBirth?: string | null;
  [k: string]: unknown;
};

let f: Fixture;
let hr: TestUser;
let manager: TestUser;
let staff: TestUser;
let director: TestUser;
let other: Fixture;
let departmentId: string;
let positionId: string;

async function createEmployee(body: Record<string, unknown> = {}) {
  const res = await call('POST', '/api/v1/employees', {
    cookie: hr.cookie,
    body: {
      firstName: 'New',
      lastName: 'Hire',
      joiningDate: '2026-01-05',
      departmentId,
      positionId,
      ...body,
    },
  });
  expect(res.status).toBe(201);
  return json<Employee>(res);
}

const post = (path: string, body: unknown, cookie = hr.cookie) =>
  call('POST', `/api/v1/employees/${path}`, { cookie, body });

beforeAll(async () => {
  f = await setupCompany('Employees Co');
  other = await setupCompany('Elsewhere Co');
  hr = await f.signIn({ roles: ['hr_admin'] });
  director = await f.signIn({ roles: ['director'] });
  manager = await f.signIn({ employee: true, strong: false, name: 'Mina Manager' });
  staff = await f.signIn({ employee: { managerId: manager.employeeId }, strong: false });
  const dep = await json<{ id: string }>(
    await call('POST', '/api/v1/departments', {
      cookie: hr.cookie,
      body: { code: 'ENG', name: 'Engineering' },
    }),
  );
  departmentId = dep.id;
  const pos = await json<{ id: string }>(
    await call('POST', '/api/v1/positions', { cookie: hr.cookie, body: { title: 'Engineer' } }),
  );
  positionId = pos.id;
}, 30_000);

describe('POST /employees', () => {
  it('creates a draft employee with the next code and audits it (US-EMP-001)', async () => {
    const res = await call('POST', '/api/v1/employees', {
      cookie: hr.cookie,
      body: {
        firstName: 'Rahima',
        lastName: 'Akter',
        workEmail: 'rahima@example.test',
        joiningDate: '2026-02-01',
        departmentId,
        positionId,
      },
    });
    expect(res.status).toBe(201);
    const emp = await json<Employee>(res);
    expect(emp).toMatchObject({ view: 'full', status: 'draft', employeeCode: 'EMP-0001', version: 1 });
    expect(emp.department?.name).toBe('Engineering');
    expect(res.headers.get('Location')).toBe(`/api/v1/employees/${emp.id}`);
    expect(JSON.stringify(emp)).not.toMatch(/salary|gross/i);
    const second = await createEmployee();
    expect(second.employeeCode).toBe('EMP-0002');
    expect((await auditFor(f.db, emp.id)).map((a) => a.action)).toEqual(['employee.created']);
  });

  it('returns 400 for a missing required field from employees.required_fields', async () => {
    const res = await call('POST', '/api/v1/employees', {
      cookie: hr.cookie,
      body: { firstName: 'No', lastName: 'Department', joiningDate: '2026-01-01', positionId },
    });
    expect(res.status).toBe(400);
    const body = await json<{ code: string; errors: { path: string; code: string }[] }>(res);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.errors).toEqual([expect.objectContaining({ path: '/departmentId', code: 'required' })]);
  });

  it('returns 400 for unknown properties and unknown references', async () => {
    const extra = await call('POST', '/api/v1/employees', {
      cookie: hr.cookie,
      body: { firstName: 'A', lastName: 'B', salary: '100' },
    });
    expect(extra.status).toBe(400);
    const missing = await call('POST', '/api/v1/employees', {
      cookie: hr.cookie,
      body: {
        firstName: 'A',
        lastName: 'B',
        joiningDate: '2026-01-01',
        departmentId,
        positionId,
        managerId: '01900000-0000-7000-8000-000000000000',
      },
    });
    expect(missing.status).toBe(400);
    expect((await json<{ errors: { path: string }[] }>(missing)).errors[0]?.path).toBe('/managerId');
  });

  it('returns 409 WORK_EMAIL_TAKEN for a duplicate work email, case-insensitively', async () => {
    await createEmployee({ workEmail: 'dup@example.test' });
    const res = await call('POST', '/api/v1/employees', {
      cookie: hr.cookie,
      body: {
        firstName: 'Second',
        lastName: 'Person',
        workEmail: 'DUP@example.test',
        joiningDate: '2026-01-01',
        departmentId,
        positionId,
      },
    });
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe('WORK_EMAIL_TAKEN');
  });

  it('returns 403 to roles without employee.manage', async () => {
    for (const user of [director, manager, staff]) {
      const res = await call('POST', '/api/v1/employees', {
        cookie: user.cookie,
        body: { firstName: 'X', lastName: 'Y' },
      });
      expect(res.status).toBe(403);
    }
  });
});

describe('GET /employees', () => {
  it('paginates, filters and sorts for readers with employee.read.all (US-EMP-002)', async () => {
    await createEmployee({ firstName: 'Zed', lastName: 'Zulu', joiningDate: '2026-03-01' });
    await createEmployee({ firstName: 'Abe', lastName: 'Alpha', joiningDate: '2026-04-01' });
    const res = await call(
      'GET',
      `/api/v1/employees?departmentId=${departmentId}&sort=-joiningDate&pageSize=2`,
      {
        cookie: director.cookie,
      },
    );
    expect(res.status).toBe(200);
    const body = await json<{ data: Employee[]; page: { totalItems: number; size: number } }>(res);
    expect(body.page.size).toBe(2);
    expect(body.page.totalItems).toBeGreaterThanOrEqual(4);
    expect(body.data.map((e) => e.joiningDate)).toEqual(['2026-04-01', '2026-03-01']);
    expect(body.data[0]?.view).toBe('basic');
    expect(body.data[0]).not.toHaveProperty('dateOfBirth');

    const search = await json<{ data: Employee[] }>(
      await call('GET', '/api/v1/employees?q=zul', { cookie: director.cookie }),
    );
    expect(search.data.map((e) => e.lastName)).toEqual(['Zulu']);
    const byStatus = await json<{ data: Employee[] }>(
      await call('GET', '/api/v1/employees?status=draft,probation', { cookie: director.cookie }),
    );
    expect(byStatus.data.every((e) => ['draft', 'probation'].includes(e.status))).toBe(true);
  });

  it('shows a manager only their direct and indirect reports', async () => {
    const indirect = await f.employee({ managerId: staff.employeeId });
    const body = await json<{ data: Employee[] }>(
      await call('GET', '/api/v1/employees', { cookie: manager.cookie }),
    );
    expect(body.data.map((e) => e.id).sort()).toEqual([staff.employeeId, indirect].sort());
  });

  it('returns 403 to an employee without a list permission', async () => {
    const loner = await f.signIn({ employee: true, strong: false });
    expect((await call('GET', '/api/v1/employees', { cookie: loner.cookie })).status).toBe(403);
  });

  it('returns 400 for unknown filters, bad sorts and short searches', async () => {
    for (const q of ['?salary=1', '?sort=salary', '?q=a', '?pageSize=101', '?status=gone']) {
      expect((await call('GET', `/api/v1/employees${q}`, { cookie: hr.cookie })).status).toBe(400);
    }
  });

  it('hides archived employees unless asked for (US-EMP-009)', async () => {
    const archived = await f.employee({ status: 'archived' });
    const visible = await json<{ data: Employee[] }>(
      await call('GET', '/api/v1/employees?pageSize=100', { cookie: hr.cookie }),
    );
    expect(visible.data.map((e) => e.id)).not.toContain(archived);
    const filtered = await json<{ data: Employee[] }>(
      await call('GET', '/api/v1/employees?status=archived', { cookie: hr.cookie }),
    );
    expect(filtered.data.map((e) => e.id)).toContain(archived);
  });
});

describe('GET /employees/{id}', () => {
  it('returns the DTO matching the permission (SECURITY-MODEL §5)', async () => {
    const asHr = await json<Employee>(
      await call('GET', `/api/v1/employees/${staff.employeeId}`, { cookie: hr.cookie }),
    );
    expect(asHr.view).toBe('full');
    expect(asHr).toHaveProperty('account');
    const asManager = await json<Employee>(
      await call('GET', `/api/v1/employees/${staff.employeeId}`, { cookie: manager.cookie }),
    );
    expect(asManager.view).toBe('basic');
    expect(asManager).not.toHaveProperty('dateOfBirth');
    const asSelf = await json<Employee>(
      await call('GET', `/api/v1/employees/${staff.employeeId}`, { cookie: staff.cookie }),
    );
    expect(asSelf.view).toBe('self');
    expect(asSelf).toHaveProperty('dateOfBirth');
    expect(asSelf).not.toHaveProperty('account');
  });

  it('returns 404 for another employee, the manager upward, and another company (IDOR)', async () => {
    expect(
      (await call('GET', `/api/v1/employees/${manager.employeeId}`, { cookie: staff.cookie })).status,
    ).toBe(404);
    const stranger = await f.employee();
    expect((await call('GET', `/api/v1/employees/${stranger}`, { cookie: manager.cookie })).status).toBe(404);
    const foreign = await other.employee();
    expect((await call('GET', `/api/v1/employees/${foreign}`, { cookie: hr.cookie })).status).toBe(404);
  });

  it('serves /me/profile from the session', async () => {
    const res = await call('GET', '/api/v1/me/profile', { cookie: staff.cookie });
    expect(res.status).toBe(200);
    expect(await json<Employee>(res)).toMatchObject({ id: staff.employeeId, view: 'self' });
    expect((await call('GET', '/api/v1/me/profile', { cookie: hr.cookie })).status).toBe(403);
  });
});

describe('PATCH /employees/{id}', () => {
  it('updates fields with optimistic locking and audits the changes', async () => {
    const emp = await createEmployee();
    const res = await call('PATCH', `/api/v1/employees/${emp.id}`, {
      cookie: hr.cookie,
      body: { preferredName: 'Neo', dateOfBirth: '1990-05-01', version: emp.version },
    });
    expect(res.status).toBe(200);
    expect(await json<Employee>(res)).toMatchObject({
      preferredName: 'Neo',
      displayName: 'Neo Hire',
      version: 2,
    });
    const stale = await call('PATCH', `/api/v1/employees/${emp.id}`, {
      cookie: hr.cookie,
      body: { preferredName: 'Old', version: 1 },
    });
    expect(stale.status).toBe(409);
    expect((await json(stale)).code).toBe('VERSION_CONFLICT');
    const audit = (await auditFor(f.db, emp.id)).find((a) => a.action === 'employee.updated');
    // Date of birth is personal data: the audit keeps the field name, not the value (AUDIT.md §4).
    expect(audit?.metadata).toEqual({
      changes: { preferredName: { from: null, to: 'Neo' }, dateOfBirth: 'changed' },
    });
  });

  it('rejects a self manager and a reporting cycle (BUSINESS-RULES §7.1)', async () => {
    const top = await createEmployee();
    const mid = await createEmployee({ managerId: top.id });
    const self = await call('PATCH', `/api/v1/employees/${top.id}`, {
      cookie: hr.cookie,
      body: { managerId: top.id, version: top.version },
    });
    expect(self.status).toBe(409);
    expect((await json(self)).code).toBe('SELF_MANAGER');
    const cycle = await call('PATCH', `/api/v1/employees/${top.id}`, {
      cookie: hr.cookie,
      body: { managerId: mid.id, version: top.version },
    });
    expect(cycle.status).toBe(409);
    expect((await json(cycle)).code).toBe('REPORTING_CYCLE');
  });

  it('re-assigns pending approval steps to the new manager', async () => {
    const newManager = await f.signIn({ employee: true, strong: false });
    const report = await f.signIn({ employee: { managerId: manager.employeeId }, strong: false });
    const claimId = crypto.randomUUID();
    await f.db.insert(schema.reimbursementClaims).values({
      id: claimId,
      companyId: f.companyId,
      claimNumber: `RC-${claimId.slice(0, 6)}`,
      employeeId: report.employeeId as string,
      expenseDate: '2026-10-01',
      amount: '250.00',
      description: 'Rickshaw to client',
      status: 'submitted',
    });
    const requestId = crypto.randomUUID();
    await f.db.insert(schema.approvalRequests).values({
      id: requestId,
      companyId: f.companyId,
      subjectType: 'reimbursement_claim',
      reimbursementClaimId: claimId,
      requesterUserId: report.userId,
      subjectEmployeeId: report.employeeId,
    });
    await f.db.insert(schema.approvalSteps).values({
      id: crypto.randomUUID(),
      approvalRequestId: requestId,
      sequence: 1,
      approverUserId: manager.userId,
    });
    const before = await json<Employee>(
      await call('GET', `/api/v1/employees/${report.employeeId}`, { cookie: hr.cookie }),
    );
    const res = await call('PATCH', `/api/v1/employees/${report.employeeId}`, {
      cookie: hr.cookie,
      body: { managerId: newManager.employeeId, version: before.version },
    });
    expect(res.status).toBe(200);
    const steps = await f.db
      .select()
      .from(schema.approvalSteps)
      .where(eq(schema.approvalSteps.approvalRequestId, requestId))
      .orderBy(schema.approvalSteps.sequence);
    expect(steps.map((s) => [s.decision, s.approverUserId])).toEqual([
      ['skipped', manager.userId],
      ['pending', newManager.userId],
    ]);
    // The placement change of a hired employee is recorded in the history.
    const history = await json<{ data: { type: string; status: string }[] }>(
      await call('GET', `/api/v1/employees/${report.employeeId}/history`, { cookie: hr.cookie }),
    );
    expect(history.data[0]).toMatchObject({ type: 'manager_changed', status: 'applied' });
  });

  it('returns 403 to a manager and 404 for another company', async () => {
    const res = await call('PATCH', `/api/v1/employees/${staff.employeeId}`, {
      cookie: manager.cookie,
      body: { preferredName: 'X', version: 1 },
    });
    expect(res.status).toBe(403);
    const foreign = await other.employee();
    const cross = await call('PATCH', `/api/v1/employees/${foreign}`, {
      cookie: hr.cookie,
      body: { preferredName: 'X', version: 1 },
    });
    expect(cross.status).toBe(404);
  });
});

describe('lifecycle (DOMAIN-MODEL §5.2)', () => {
  it('walks draft → preboarding → probation → active → notice → separated → archived', async () => {
    const id = await f.employee({ status: 'draft' });
    const emp = await json<Employee>(await call('GET', `/api/v1/employees/${id}`, { cookie: hr.cookie }));
    let cur = emp;
    const step = async (path: string, body: Record<string, unknown>, status: string) => {
      const res = await post(`${cur.id}/${path}`, { ...body, version: cur.version });
      expect(res.status, await res.clone().text()).toBe(200);
      cur = await json<Employee>(res);
      expect(cur.status).toBe(status);
    };
    await step('start-preboarding', {}, 'preboarding');
    await step('hire', { effectiveDate: '2026-01-10', probationEndDate: '2026-07-10' }, 'probation');
    expect(cur).toMatchObject({ joiningDate: '2026-01-10', probationEndDate: '2026-07-10' });
    await step('confirm', { effectiveDate: '2026-07-10' }, 'active');
    await step('start-notice', { effectiveDate: '2026-09-01' }, 'notice_period');
    await step('separate', { separationDate: '2026-09-30', separationType: 'resignation' }, 'separated');
    expect(cur.separationDate).toBe('2026-09-30');
    await step('archive', {}, 'archived');

    const actions = (await auditFor(f.db, emp.id)).map((a) => a.action);
    expect(actions.filter((a) => a === 'employee.status_changed')).toHaveLength(5);
    expect(actions).toContain('employee.archived');
    const history = await json<{ data: { type: string }[] }>(
      await call('GET', `/api/v1/employees/${emp.id}/history`, { cookie: hr.cookie }),
    );
    expect(history.data.map((e) => e.type)).toEqual(
      expect.arrayContaining(['hired', 'confirmed', 'separated', 'status_changed']),
    );
  });

  it('hires straight to active without probation, and rehires a separated employee', async () => {
    const id = await f.employee({ status: 'draft' });
    const emp = await json<Employee>(await call('GET', `/api/v1/employees/${id}`, { cookie: hr.cookie }));
    const pre = await json<Employee>(await post(`${emp.id}/start-preboarding`, { version: emp.version }));
    const hired = await json<Employee>(
      await post(`${emp.id}/hire`, { effectiveDate: '2025-01-01', version: pre.version }),
    );
    expect(hired.status).toBe('active');
    const sep = await json<Employee>(
      await post(`${emp.id}/separate`, {
        separationDate: '2025-06-30',
        separationType: 'contract_end',
        version: hired.version,
      }),
    );
    expect(sep.status).toBe('separated');
    const early = await post(`${emp.id}/rehire`, { effectiveDate: '2025-06-01', version: sep.version });
    expect(early.status).toBe(422);
    expect((await json(early)).code).toBe('INVALID_DATE');
    const rehired = await json<Employee>(
      await post(`${emp.id}/rehire`, { effectiveDate: '2026-02-01', version: sep.version }),
    );
    expect(rehired).toMatchObject({
      status: 'active',
      employeeCode: emp.employeeCode,
      joiningDate: '2026-02-01',
    });
    expect(rehired.separationDate).toBeNull();
  });

  it('rejects transitions not in the state machine with 409 INVALID_TRANSITION (US-EMP-004)', async () => {
    const draft = await createEmployee();
    const cases: [string, Record<string, unknown>][] = [
      ['separate', { separationDate: '2026-02-01', separationType: 'other' }],
      ['hire', { effectiveDate: '2026-02-01' }],
      ['confirm', { effectiveDate: '2026-02-01' }],
      ['start-notice', { effectiveDate: '2026-02-01' }],
      ['rehire', { effectiveDate: '2026-02-01' }],
      ['archive', {}],
    ];
    for (const [path, body] of cases) {
      const res = await post(`${draft.id}/${path}`, { ...body, version: draft.version });
      expect(res.status, path).toBe(409);
      expect((await json(res)).code).toBe('INVALID_TRANSITION');
    }
    const pre = await json<Employee>(await post(`${draft.id}/start-preboarding`, { version: draft.version }));
    const again = await post(`${draft.id}/start-preboarding`, { version: pre.version });
    expect(again.status).toBe(409);
  });

  it('schedules a future-dated transition and refuses a second one while it waits', async () => {
    const emp = await f.employee({ status: 'probation', joiningDate: '2026-01-01' });
    const before = await json<Employee>(await call('GET', `/api/v1/employees/${emp}`, { cookie: hr.cookie }));
    const res = await post(`${emp}/confirm`, { effectiveDate: '2030-06-01', version: before.version });
    expect(res.status).toBe(200);
    const after = await json<Employee>(res);
    expect(after.status).toBe('probation');
    const [event] = await f.db
      .select()
      .from(schema.employmentEvents)
      .where(eq(schema.employmentEvents.employeeId, emp));
    expect(event).toMatchObject({ type: 'confirmed', status: 'scheduled', effectiveDate: '2030-06-01' });
    const second = await post(`${emp}/separate`, {
      separationDate: '2030-01-01',
      separationType: 'other',
      version: after.version,
    });
    expect(second.status).toBe(409);
  });

  it('requires a fresh strong session to separate (REAUTH_REQUIRED)', async () => {
    const emp = await f.employee({ status: 'active' });
    const hr2 = await f.signIn({ roles: ['hr_admin'] });
    const res = await call('POST', `/api/v1/employees/${emp}/separate`, {
      cookie: hr2.cookie,
      // 20 minutes later: still inside the 1 h privileged idle window, no longer within 15 min of strong auth.
      now: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      body: { separationDate: '2026-12-31', separationType: 'resignation', version: 1 },
    });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('REAUTH_REQUIRED');
  });

  it('returns 400 for invalid bodies, 403 for non-HR and 404 out of scope', async () => {
    const emp = await f.employee({ status: 'preboarding' });
    expect((await post(`${emp}/hire`, { effectiveDate: 'soon', version: 1 })).status).toBe(400);
    expect(
      (await post(`${emp}/hire`, { effectiveDate: '2026-02-01', probationEndDate: '2026-01-01', version: 1 }))
        .status,
    ).toBe(400);
    expect(
      (await post(`${emp}/hire`, { effectiveDate: '2026-02-01', version: 1 }, manager.cookie)).status,
    ).toBe(403);
    const foreign = await other.employee({ status: 'preboarding' });
    expect((await post(`${foreign}/hire`, { effectiveDate: '2026-02-01', version: 1 })).status).toBe(404);
    expect((await post(`${emp}/hire`, { effectiveDate: '2026-02-01', version: 9 })).status).toBe(409);
  });
});

describe('employment events and history', () => {
  it('applies a past-dated transfer at once and schedules a future promotion', async () => {
    const emp = await f.employee({ status: 'active' });
    const dep2 = await json<{ id: string }>(
      await call('POST', '/api/v1/departments', {
        cookie: hr.cookie,
        body: { code: 'OPS', name: 'Operations' },
      }),
    );
    const now = await post(`${emp}/employment-events`, {
      type: 'transferred',
      effectiveDate: '2026-03-01',
      departmentId: dep2.id,
      reason: 'Team change',
    });
    expect(now.status).toBe(201);
    expect(await json(now)).toMatchObject({
      status: 'applied',
      changes: { departmentId: { from: null, to: dep2.id } },
    });
    const later = await post(`${emp}/employment-events`, {
      type: 'promoted',
      effectiveDate: '2030-01-01',
      positionId,
    });
    expect(await json(later)).toMatchObject({ status: 'scheduled', type: 'promoted' });
    const current = await json<Employee>(
      await call('GET', `/api/v1/employees/${emp}`, { cookie: hr.cookie }),
    );
    expect(current.department?.id).toBe(dep2.id);
    expect(current).toMatchObject({ position: null });
  });

  it('validates the event body and the manager rules', async () => {
    const emp = await f.employee({ status: 'active' });
    expect(
      (await post(`${emp}/employment-events`, { type: 'promoted', effectiveDate: '2026-01-01' })).status,
    ).toBe(400);
    expect(
      (
        await post(`${emp}/employment-events`, {
          type: 'manager_changed',
          effectiveDate: '2026-01-01',
          managerId: emp,
        })
      ).status,
    ).toBe(409);
    const same = await post(`${emp}/employment-events`, {
      type: 'manager_changed',
      effectiveDate: '2026-01-01',
      managerId: null,
    });
    expect(same.status).toBe(422);
  });

  it('lets a manager read a report’s history without salary events, and hides it from others', async () => {
    await f.db.insert(schema.employmentEvents).values({
      id: crypto.randomUUID(),
      companyId: f.companyId,
      employeeId: staff.employeeId as string,
      type: 'salary_changed',
      effectiveDate: '2026-01-01',
      status: 'applied',
      changes: { salaryStructureId: { from: null, to: 'x' } },
    });
    const asManager = await json<{ data: { type: string }[] }>(
      await call('GET', `/api/v1/employees/${staff.employeeId}/history`, { cookie: manager.cookie }),
    );
    expect(asManager.data.map((e) => e.type)).not.toContain('salary_changed');
    const asSelf = await json<{ data: { type: string }[] }>(
      await call('GET', `/api/v1/employees/${staff.employeeId}/history`, { cookie: staff.cookie }),
    );
    expect(asSelf.data.map((e) => e.type)).toContain('salary_changed');
    const res = await call('GET', `/api/v1/employees/${manager.employeeId}/history`, {
      cookie: staff.cookie,
    });
    expect(res.status).toBe(404);
  });
});

describe('contact (restricted)', () => {
  it('lets HR create and update contact data, auditing field names only', async () => {
    const emp = await f.employee();
    const empty = await json<{ version: number; emergencyContacts: unknown[] }>(
      await call('GET', `/api/v1/employees/${emp}/contact`, { cookie: hr.cookie }),
    );
    expect(empty).toMatchObject({ version: 0, emergencyContacts: [] });
    const created = await call('PATCH', `/api/v1/employees/${emp}/contact`, {
      cookie: hr.cookie,
      body: {
        personalPhone: '+8801700000000',
        nationalIdNumber: '1234567890',
        emergencyContacts: [{ name: 'Ayesha', relationship: 'Sister', phone: '+8801800000000' }],
        version: 0,
      },
    });
    expect(created.status).toBe(200);
    const contact = await json<{ version: number; personalPhone: string }>(created);
    expect(contact).toMatchObject({ version: 1, personalPhone: '+8801700000000' });
    const updated = await call('PATCH', `/api/v1/employees/${emp}/contact`, {
      cookie: hr.cookie,
      body: { presentAddress: 'Road 1, Dhaka', version: 1 },
    });
    expect(updated.status).toBe(200);
    const stale = await call('PATCH', `/api/v1/employees/${emp}/contact`, {
      cookie: hr.cookie,
      body: { presentAddress: 'Road 2', version: 1 },
    });
    expect(stale.status).toBe(409);

    const audit = await auditFor(f.db, emp);
    const updates = audit.filter((a) => a.action === 'employee.contact_updated');
    expect(updates.map((a) => a.metadata)).toEqual([
      { fields: ['personalPhone', 'nationalIdNumber', 'emergencyContacts'] },
      { fields: ['presentAddress'] },
    ]);
    expect(JSON.stringify(audit)).not.toContain('1234567890');
    expect(audit.some((a) => a.action === 'employee.contact_viewed')).toBe(true);
  });

  it('lets an employee read their own contact data but nobody else’s', async () => {
    expect(
      (await call('GET', `/api/v1/employees/${staff.employeeId}/contact`, { cookie: staff.cookie })).status,
    ).toBe(200);
    expect(
      (await call('GET', `/api/v1/employees/${staff.employeeId}/contact`, { cookie: manager.cookie })).status,
    ).toBe(404);
    expect(
      (await call('GET', `/api/v1/employees/${staff.employeeId}/contact`, { cookie: director.cookie }))
        .status,
    ).toBe(404);
    const res = await call('PATCH', `/api/v1/employees/${staff.employeeId}/contact`, {
      cookie: staff.cookie,
      body: { personalPhone: '1', version: 0 },
    });
    expect(res.status).toBe(403);
    const bad = await call('PATCH', `/api/v1/employees/${staff.employeeId}/contact`, {
      cookie: hr.cookie,
      body: { personalEmail: 'nope', version: 0 },
    });
    expect(bad.status).toBe(400);
  });
});

describe('contracts (FR-DOC-009)', () => {
  it('creates, lists and updates contracts with audit', async () => {
    const emp = await f.employee();
    const res = await post(`${emp}/contracts`, {
      type: 'fixed_term',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    expect(res.status).toBe(201);
    const contract = await json<{ id: string; status: string; version: number }>(res);
    expect(contract.status).toBe('active');
    const list = await json<{ data: { id: string }[] }>(
      await call('GET', `/api/v1/employees/${emp}/contracts`, { cookie: hr.cookie }),
    );
    expect(list.data.map((c) => c.id)).toEqual([contract.id]);
    const patched = await call('PATCH', `/api/v1/employees/${emp}/contracts/${contract.id}`, {
      cookie: hr.cookie,
      body: { status: 'superseded', version: contract.version },
    });
    expect(patched.status).toBe(200);
    expect((await auditFor(f.db, contract.id)).map((a) => a.action)).toEqual([
      'contract.created',
      'contract.updated',
    ]);
  });

  it('validates contract dates and the fixed-term end date', async () => {
    const emp = await f.employee();
    expect((await post(`${emp}/contracts`, { type: 'fixed_term', startDate: '2026-01-01' })).status).toBe(
      400,
    );
    const c = await json<{ id: string; version: number }>(
      await post(`${emp}/contracts`, { type: 'permanent', startDate: '2026-01-01' }),
    );
    const res = await call('PATCH', `/api/v1/employees/${emp}/contracts/${c.id}`, {
      cookie: hr.cookie,
      body: { type: 'fixed_term', version: c.version },
    });
    expect(res.status).toBe(400);
  });

  it('lets an employee read their own contracts only', async () => {
    expect(
      (await call('GET', `/api/v1/employees/${staff.employeeId}/contracts`, { cookie: staff.cookie })).status,
    ).toBe(200);
    expect(
      (await call('GET', `/api/v1/employees/${staff.employeeId}/contracts`, { cookie: manager.cookie }))
        .status,
    ).toBe(404);
    expect(
      (
        await post(
          `${staff.employeeId}/contracts`,
          { type: 'permanent', startDate: '2026-01-01' },
          staff.cookie,
        )
      ).status,
    ).toBe(403);
  });
});
