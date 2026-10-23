import { schema } from '@hrm/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditFor, call, type Fixture, json, setupCompany, type TestUser } from '../harness';

const NOW = '2026-06-01T04:00:00Z';

let f: Fixture;
let other: Fixture;
let hr: TestUser;
let manager: TestUser;
let report: TestUser;
let employee: TestUser;
let types: Record<string, string>;
let seq = 0;
const key = () => `admin-key-${Date.now()}-${seq++}`;

function adjust(user: TestUser, body: Record<string, unknown>, k: string | null = key()) {
  return call('POST', '/api/v1/leave/balances/adjustments', {
    cookie: user.cookie,
    now: NOW,
    headers: k ? { 'Idempotency-Key': k } : {},
    body,
  });
}

beforeAll(async () => {
  f = await setupCompany('Leave Admin Co');
  other = await setupCompany('Leave Admin Other');
  hr = await f.signIn({ roles: ['hr_admin'] });
  manager = await f.signIn({ employee: true, strong: false });
  report = await f.signIn({ employee: { managerId: manager.employeeId }, strong: false });
  employee = await f.signIn({ employee: true, strong: false });
  const list = await json<{ data: { id: string; code: string }[] }>(
    await call('GET', '/api/v1/leave/types', { cookie: employee.cookie, now: NOW }),
  );
  types = Object.fromEntries(list.data.map((t) => [t.code, t.id]));
}, 120_000);

describe('leave types', () => {
  it('lists the seeded types with the policy in force to any employee (US-LEAVE-001)', async () => {
    const res = await call('GET', '/api/v1/leave/types', { cookie: employee.cookie, now: NOW });
    const body = await json<{ data: { code: string; currentPolicy: { allocationMethod: string } | null }[] }>(
      res,
    );
    expect(body.data.map((t) => t.code)).toEqual(['CL', 'SL', 'AL', 'COMP']);
    expect(body.data[0]?.currentPolicy?.allocationMethod).toBe('annual_grant');
    expect(body.data[2]?.currentPolicy).toMatchObject({
      allocationMethod: 'per_days_worked',
      maxBalance: '40.00',
    });
  });

  it('lets HR create and update a type, audited', async () => {
    const res = await call('POST', '/api/v1/leave/types', {
      cookie: hr.cookie,
      body: { code: 'mat', name: 'Maternity leave', allowsHalfDay: false, sortOrder: 10 },
    });
    expect(res.status).toBe(201);
    const type = await json<{ id: string; code: string; version: number; currentPolicy: null }>(res);
    expect(type).toMatchObject({ code: 'MAT', currentPolicy: null });
    const upd = await call('PATCH', `/api/v1/leave/types/${type.id}`, {
      cookie: hr.cookie,
      body: { requiresReason: true, version: type.version },
    });
    expect(upd.status).toBe(200);
    expect((await auditFor(f.db, type.id)).map((a) => a.action)).toEqual([
      'leave_type.created',
      'leave_type.updated',
    ]);
    const stale = await call('PATCH', `/api/v1/leave/types/${type.id}`, {
      cookie: hr.cookie,
      body: { name: 'X', version: type.version },
    });
    expect(stale.status).toBe(409);
  });

  it('returns 409 DUPLICATE for an existing code, 400 for a bad code and 403 to an employee', async () => {
    const dup = await call('POST', '/api/v1/leave/types', {
      cookie: hr.cookie,
      body: { code: 'CL', name: 'Again' },
    });
    expect(dup.status).toBe(409);
    expect((await json(dup)).code).toBe('DUPLICATE');
    const bad = await call('POST', '/api/v1/leave/types', {
      cookie: hr.cookie,
      body: { code: 'c1', name: 'Bad' },
    });
    expect(bad.status).toBe(400);
    const denied = await call('POST', '/api/v1/leave/types', {
      cookie: employee.cookie,
      body: { code: 'XX', name: 'Nope' },
    });
    expect(denied.status).toBe(403);
  });

  it('returns 404 for a type of another company', async () => {
    const otherHr = await other.signIn({ roles: ['hr_admin'] });
    const theirs = await json<{ data: { id: string }[] }>(
      await call('GET', '/api/v1/leave/types', { cookie: otherHr.cookie }),
    );
    const res = await call('PATCH', `/api/v1/leave/types/${theirs.data[0]?.id}`, {
      cookie: hr.cookie,
      body: { name: 'Mine', version: 1 },
    });
    expect(res.status).toBe(404);
  });
});

describe('leave policies', () => {
  it('adds a version effective later and ends the current one the day before', async () => {
    const res = await call('POST', `/api/v1/leave/types/${types.SL}/policies`, {
      cookie: hr.cookie,
      now: NOW,
      body: { effectiveFrom: '2027-01-01', allocationMethod: 'annual_grant', annualEntitlement: '12' },
    });
    expect(res.status).toBe(201);
    const created = await json<{ id: string; annualEntitlement: string }>(res);
    expect(created.annualEntitlement).toBe('12.00');
    const list = await json<{ data: { effectiveFrom: string; effectiveTo: string | null }[] }>(
      await call('GET', `/api/v1/leave/types/${types.SL}/policies`, { cookie: hr.cookie }),
    );
    expect(list.data.map((p) => [p.effectiveFrom, p.effectiveTo])).toEqual([
      ['2027-01-01', null],
      ['2026-01-01', '2026-12-31'],
    ]);
    expect((await auditFor(f.db, created.id)).map((a) => a.action)).toEqual(['leave_policy.created']);
    // Current-year balances keep the current version (US-LEAVE-001).
    const types2026 = await json<{ data: { code: string; currentPolicy: { annualEntitlement: string } }[] }>(
      await call('GET', '/api/v1/leave/types', { cookie: employee.cookie, now: NOW }),
    );
    expect(types2026.data.find((t) => t.code === 'SL')?.currentPolicy.annualEntitlement).toBe('14.00');
  });

  it('returns 422 when a version would overlap a later one, and 400 for a past start', async () => {
    const overlap = await call('POST', `/api/v1/leave/types/${types.SL}/policies`, {
      cookie: hr.cookie,
      now: NOW,
      body: { effectiveFrom: '2026-09-01', allocationMethod: 'annual_grant', annualEntitlement: '13' },
    });
    expect(overlap.status).toBe(422);
    const past = await call('POST', `/api/v1/leave/types/${types.CL}/policies`, {
      cookie: hr.cookie,
      now: NOW,
      body: { effectiveFrom: '2026-05-01', allocationMethod: 'annual_grant', annualEntitlement: '10' },
    });
    expect(past.status).toBe(400);
  });

  it('returns 400 when the allocation method lacks its parameter, 403 to an employee, 404 for an unknown type', async () => {
    const missing = await call('POST', `/api/v1/leave/types/${types.CL}/policies`, {
      cookie: hr.cookie,
      now: NOW,
      body: { effectiveFrom: '2026-08-01', allocationMethod: 'monthly_accrual' },
    });
    expect(missing.status).toBe(400);
    expect((await json<{ errors: { path: string }[] }>(missing)).errors[0]?.path).toBe('/accrualPerMonth');
    const denied = await call('GET', `/api/v1/leave/types/${types.CL}/policies`, { cookie: employee.cookie });
    expect(denied.status).toBe(403);
    const unknown = await call('GET', '/api/v1/leave/types/0192f0c4-0000-7000-8000-000000000000/policies', {
      cookie: hr.cookie,
    });
    expect(unknown.status).toBe(404);
  });
});

describe('balance adjustments (US-LEAVE-007)', () => {
  it('posts an adjustment with a reason, audits it and shows it in the ledger', async () => {
    const res = await adjust(hr, {
      employeeId: report.employeeId,
      leaveTypeId: types.COMP,
      year: 2026,
      amount: '1',
      reason: 'Worked on Victory Day',
    });
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({ leaveTypeCode: 'COMP', adjusted: '1.00', available: '1.00' });
    const [entry] = await f.db
      .select()
      .from(schema.leaveLedgerEntries)
      .where(eq(schema.leaveLedgerEntries.employeeId, report.employeeId as string));
    expect(entry).toMatchObject({ type: 'adjustment', amount: '1.00', reason: 'Worked on Victory Day' });
    const [audit] = await auditFor(f.db, entry?.id as string);
    expect(audit).toMatchObject({ action: 'leave_balance.adjusted', employeeId: report.employeeId });
    expect(audit?.metadata).toMatchObject({ amount: '1.00', reason: 'Worked on Victory Day' });
  });

  it('applies the same Idempotency-Key once and replays the response', async () => {
    const k = key();
    const body = {
      employeeId: employee.employeeId,
      leaveTypeId: types.CL,
      year: 2026,
      amount: '2.5',
      reason: 'Opening',
    };
    const first = await adjust(hr, body, k);
    const second = await adjust(hr, body, k);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.headers.get('Idempotent-Replayed')).toBe('true');
    const rows = await f.db
      .select()
      .from(schema.leaveLedgerEntries)
      .where(eq(schema.leaveLedgerEntries.employeeId, employee.employeeId as string));
    expect(rows).toHaveLength(1);
    const reused = await adjust(hr, { ...body, amount: '3' }, k);
    expect(reused.status).toBe(409);
    expect((await json(reused)).code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('returns 400 without a reason or Idempotency-Key, 403 to a manager, 422 below zero', async () => {
    const base = { employeeId: report.employeeId, leaveTypeId: types.CL, year: 2026, amount: '1' };
    expect((await adjust(hr, base)).status).toBe(400);
    const noKey = await adjust(hr, { ...base, reason: 'x' }, null);
    expect((await json(noKey)).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect((await adjust(manager, { ...base, reason: 'x' })).status).toBe(403);
    const negative = await adjust(hr, { ...base, amount: '-5', reason: 'Correction' });
    expect(negative.status).toBe(422);
    expect((await json(negative)).code).toBe('INSUFFICIENT_BALANCE');
  });
});

describe('balances and ledger reads', () => {
  it('GET /leave/balances/me returns every active type for the year', async () => {
    const res = await call('GET', '/api/v1/leave/balances/me', { cookie: report.cookie, now: NOW });
    const body = await json<{ year: number; data: { leaveTypeCode: string; available: string }[] }>(res);
    expect(body.year).toBe(2026);
    expect(body.data.map((b) => b.leaveTypeCode)).toEqual(['CL', 'SL', 'AL', 'COMP', 'MAT']);
    expect(body.data.find((b) => b.leaveTypeCode === 'COMP')?.available).toBe('1.00');
  });

  it('GET /leave/balances is scoped: HR sees all, a manager the team, an employee is refused', async () => {
    const all = await json<{ data: { employeeId: string }[]; page: { totalItems: number } }>(
      await call('GET', '/api/v1/leave/balances?pageSize=100', { cookie: hr.cookie, now: NOW }),
    );
    expect(new Set(all.data.map((b) => b.employeeId)).size).toBe(3);
    const team = await json<{ data: { employeeId: string }[] }>(
      await call('GET', `/api/v1/leave/balances?leaveTypeId=${types.CL}`, {
        cookie: manager.cookie,
        now: NOW,
      }),
    );
    expect(new Set(team.data.map((b) => b.employeeId))).toEqual(
      new Set([report.employeeId, manager.employeeId]),
    );
    expect((await call('GET', '/api/v1/leave/balances', { cookie: employee.cookie })).status).toBe(403);
  });

  it('GET /leave/balances/{employeeId}/ledger: own and team visible, others 404 (IDOR)', async () => {
    const own = await call('GET', `/api/v1/leave/balances/${report.employeeId}/ledger?year=2026`, {
      cookie: report.cookie,
    });
    expect(own.status).toBe(200);
    expect((await json<{ data: { type: string }[] }>(own)).data.map((e) => e.type)).toEqual(['adjustment']);
    const byManager = await call('GET', `/api/v1/leave/balances/${report.employeeId}/ledger?year=2026`, {
      cookie: manager.cookie,
    });
    expect(byManager.status).toBe(200);
    const byPeer = await call('GET', `/api/v1/leave/balances/${report.employeeId}/ledger`, {
      cookie: employee.cookie,
    });
    expect(byPeer.status).toBe(404);
  });
});
