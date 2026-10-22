import { schema } from '@hrm/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditFor, call, type Fixture, json, outboxFor, setupCompany, type TestUser } from '../harness';

// Fixed business time: Monday 1 June 2026, 10:00 Asia/Dhaka (earlier than the sessions' real activity time).
const NOW = '2026-06-01T04:00:00Z';

let f: Fixture;
let other: Fixture;
let hr: TestUser;
let manager: TestUser;
let alice: TestUser;
let bob: TestUser;
let outsider: TestUser;
let types: Record<string, string>;
let keySeq = 0;

const key = () => `test-key-${Date.now()}-${keySeq++}`;
type Req = { id: string; status: string; version: number; requestNumber: string; requestedUnits: string };

async function adjust(employeeId: string, code: string, amount: string, year = 2026) {
  const res = await call('POST', '/api/v1/leave/balances/adjustments', {
    cookie: hr.cookie,
    now: NOW,
    headers: { 'Idempotency-Key': key() },
    body: { employeeId, leaveTypeId: types[code], year, amount, reason: 'Opening balance for tests' },
  });
  expect(res.status).toBe(201);
}

async function create(user: TestUser, body: Record<string, unknown>) {
  return call('POST', '/api/v1/leave/requests', {
    cookie: user.cookie,
    now: NOW,
    body: { leaveTypeId: types.CL, ...body },
  });
}

async function created(user: TestUser, body: Record<string, unknown>) {
  const res = await create(user, body);
  expect(res.status, await res.clone().text()).toBe(201);
  return json<Req>(res);
}

function act(user: TestUser, id: string, action: string, body: Record<string, unknown>, k?: string) {
  return call('POST', `/api/v1/leave/requests/${id}/${action}`, {
    cookie: user.cookie,
    now: NOW,
    body,
    ...(k ? { headers: { 'Idempotency-Key': k } } : {}),
  });
}

async function balance(user: TestUser, code: string) {
  const res = await call('GET', '/api/v1/leave/balances/me?year=2026', { cookie: user.cookie, now: NOW });
  const body = await json<{
    data: { leaveTypeCode: string; available: string; reserved: string; used: string }[];
  }>(res);
  return body.data.find((b) => b.leaveTypeCode === code);
}

async function ledgerTypes(requestId: string) {
  const rows = await f.db
    .select({ type: schema.leaveLedgerEntries.type, amount: schema.leaveLedgerEntries.amount })
    .from(schema.leaveLedgerEntries)
    .where(eq(schema.leaveLedgerEntries.leaveRequestId, requestId))
    .orderBy(schema.leaveLedgerEntries.createdAt);
  return rows.map((r) => `${r.type} ${r.amount}`);
}

beforeAll(async () => {
  f = await setupCompany('Leave Requests Co');
  other = await setupCompany('Other Leave Co');
  hr = await f.signIn({ roles: ['hr_admin'], employee: true });
  manager = await f.signIn({ employee: true, strong: false, name: 'Mona Manager' });
  alice = await f.signIn({
    employee: { managerId: manager.employeeId, firstName: 'Alice' },
    strong: false,
    name: 'Alice',
  });
  bob = await f.signIn({ employee: { managerId: manager.employeeId, firstName: 'Bob' }, strong: false });
  outsider = await f.signIn({ employee: true, strong: false });
  const list = await json<{ data: { id: string; code: string }[] }>(
    await call('GET', '/api/v1/leave/types', { cookie: alice.cookie, now: NOW }),
  );
  types = Object.fromEntries(list.data.map((t) => [t.code, t.id]));
  for (const u of [alice, bob, manager, hr, outsider]) await adjust(u.employeeId as string, 'CL', '10');
  await adjust(alice.employeeId as string, 'SL', '3');
}, 120_000);

describe('POST /leave/requests/preview', () => {
  it('counts working days by the schedule and shows the balance effect (BUSINESS-RULES 3.2)', async () => {
    const res = await call('POST', '/api/v1/leave/requests/preview', {
      cookie: bob.cookie,
      now: NOW,
      body: { leaveTypeId: types.CL, startDate: '2026-11-01', endDate: '2026-11-09' },
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      requestedUnits: '7.00',
      workingDates: [
        '2026-11-01',
        '2026-11-02',
        '2026-11-03',
        '2026-11-04',
        '2026-11-05',
        '2026-11-08',
        '2026-11-09',
      ],
      available: '10.00',
      availableAfter: '3.00',
      sufficientBalance: true,
      overlapsExisting: false,
    });
  });

  it('returns 403 to a user without an employee record', async () => {
    const admin = await f.signIn({ roles: ['system_admin'] });
    const res = await call('POST', '/api/v1/leave/requests/preview', {
      cookie: admin.cookie,
      now: NOW,
      body: { leaveTypeId: types.CL, startDate: '2026-11-01', endDate: '2026-11-01' },
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /leave/requests', () => {
  it('creates a pending request, reserves the units, and asks the manager (US-LEAVE-003)', async () => {
    const res = await create(alice, {
      startDate: '2026-06-07',
      endDate: '2026-06-08',
      reason: 'Family visit',
    });
    expect(res.status).toBe(201);
    const req = await json<Req & { onBehalf: boolean }>(res);
    expect(req).toMatchObject({ status: 'pending', requestedUnits: '2.00', onBehalf: false, version: 1 });
    expect(req.requestNumber).toMatch(/^LV-\d{6}$/);
    expect(res.headers.get('Location')).toBe(`/api/v1/leave/requests/${req.id}`);
    expect(await ledgerTypes(req.id)).toEqual(['reservation -2.00']);
    expect(await balance(alice, 'CL')).toMatchObject({ reserved: '2.00', available: '8.00' });
    expect((await auditFor(f.db, req.id)).map((a) => a.action)).toEqual(['leave_request.created']);
    const mails = await outboxFor(f.db, f.companyId, ['email.approval_requested']);
    const mine = mails.filter((m) => (m.payload as { path: string }).path.endsWith(req.id));
    expect(mine.map((m) => (m.payload as { recipientUserId: string }).recipientUserId)).toEqual([
      manager.userId,
    ]);
    const [step] = await f.db
      .select({ approver: schema.approvalSteps.approverUserId })
      .from(schema.approvalSteps)
      .innerJoin(
        schema.approvalRequests,
        eq(schema.approvalRequests.id, schema.approvalSteps.approvalRequestId),
      )
      .where(eq(schema.approvalRequests.leaveRequestId, req.id));
    expect(step?.approver).toBe(manager.userId);
  });

  it('returns 422 INSUFFICIENT_BALANCE when the request exceeds the available balance', async () => {
    const res = await create(alice, {
      leaveTypeId: types.SL,
      startDate: '2026-07-05',
      endDate: '2026-07-09',
    });
    expect(res.status).toBe(422);
    expect((await json(res)).code).toBe('INSUFFICIENT_BALANCE');
  });

  it('returns 409 OVERLAPPING_LEAVE for a date already requested, but allows the other half day', async () => {
    const first = await created(bob, {
      startDate: '2026-06-10',
      endDate: '2026-06-10',
      unit: 'half_day',
      halfDayPart: 'first_half',
    });
    expect(first.requestedUnits).toBe('0.50');
    const second = await create(bob, {
      startDate: '2026-06-10',
      endDate: '2026-06-10',
      unit: 'half_day',
      halfDayPart: 'second_half',
    });
    expect(second.status).toBe(201);
    const clash = await create(bob, {
      leaveTypeId: types.SL,
      startDate: '2026-06-09',
      endDate: '2026-06-10',
    });
    expect(clash.status).toBe(409);
    expect((await json(clash)).code).toBe('OVERLAPPING_LEAVE');
  });

  it('returns 422 LEAVE_NO_WORKING_DAYS for a weekend-only range', async () => {
    const res = await create(bob, { startDate: '2026-06-12', endDate: '2026-06-13' });
    expect(res.status).toBe(422);
    expect((await json(res)).code).toBe('LEAVE_NO_WORKING_DAYS');
  });

  it('returns 422 INVALID_DATE for a range spanning two leave years and for a past start', async () => {
    const spans = await create(bob, { startDate: '2026-12-30', endDate: '2027-01-06' });
    expect(spans.status).toBe(422);
    expect((await json(spans)).code).toBe('INVALID_DATE');
    const past = await create(bob, { startDate: '2026-05-20', endDate: '2026-05-20' });
    expect(past.status).toBe(422);
    expect((await json(past)).code).toBe('INVALID_DATE');
  });

  it('returns 422 LEAVE_NOT_ELIGIBLE before the policy eligibility date (AL after 365 days)', async () => {
    const newcomer = await f.signIn({ employee: { joiningDate: '2026-03-01' }, strong: false });
    const res = await create(newcomer, {
      leaveTypeId: types.AL,
      startDate: '2026-06-07',
      endDate: '2026-06-07',
    });
    expect(res.status).toBe(422);
    expect((await json(res)).code).toBe('LEAVE_NOT_ELIGIBLE');
  });

  it.each([
    ['end before start', { startDate: '2026-06-09', endDate: '2026-06-08' }, '/endDate'],
    [
      'half day without a part',
      { startDate: '2026-06-09', endDate: '2026-06-09', unit: 'half_day' },
      '/halfDayPart',
    ],
    ['unknown property', { startDate: '2026-06-09', endDate: '2026-06-09', days: 1 }, ''],
    [
      'unknown leave type',
      { leaveTypeId: '0192f0c4-0000-7000-8000-000000000000', startDate: '2026-06-09', endDate: '2026-06-09' },
      '/leaveTypeId',
    ],
  ])('returns 400 VALIDATION_FAILED for %s', async (_case, body, path) => {
    const res = await create(bob, body);
    expect(res.status).toBe(400);
    const problem = await json<{ code: string; errors: { path: string }[] }>(res);
    expect(problem.code).toBe('VALIDATION_FAILED');
    if (path) expect(problem.errors.map((e) => e.path)).toContain(path);
  });

  it('lets HR create on behalf, bypassing notice and auditing it (D-014)', async () => {
    const res = await create(hr, {
      employeeId: bob.employeeId,
      startDate: '2026-05-25',
      endDate: '2026-05-25',
    });
    expect(res.status).toBe(201);
    const req = await json<Req & { onBehalf: boolean; employeeId: string }>(res);
    expect(req).toMatchObject({ onBehalf: true, employeeId: bob.employeeId });
    const [audit] = await auditFor(f.db, req.id);
    expect(audit?.metadata).toMatchObject({ onBehalf: true });
  });

  it('returns 403 when a manager tries to create on behalf of a report', async () => {
    const res = await create(manager, {
      employeeId: alice.employeeId,
      startDate: '2026-06-21',
      endDate: '2026-06-21',
    });
    expect(res.status).toBe(403);
  });

  it('lets exactly one of two parallel requests through when together they exceed the balance (FR-LEAVE-013)', async () => {
    const carol = await f.signIn({ employee: { managerId: manager.employeeId }, strong: false });
    await adjust(carol.employeeId as string, 'SL', '3');
    const results = await Promise.all([
      create(carol, { leaveTypeId: types.SL, startDate: '2026-07-05', endDate: '2026-07-06' }),
      create(carol, { leaveTypeId: types.SL, startDate: '2026-07-12', endDate: '2026-07-13' }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 422]);
    const loser = results.find((r) => r.status === 422);
    expect((await json(loser as Response)).code).toBe('INSUFFICIENT_BALANCE');
    expect(await balance(carol, 'SL')).toMatchObject({ reserved: '2.00', available: '1.00' });
  });
});

describe('approve and reject', () => {
  it('approves atomically: release + usage, approval step, audit and email (US-LEAVE-004)', async () => {
    const req = await created(alice, { startDate: '2026-06-14', endDate: '2026-06-14' });
    const k = key();
    const res = await act(manager, req.id, 'approve', { comment: 'Enjoy', version: req.version }, k);
    expect(res.status).toBe(200);
    const body = await json<Req & { decisionComment: string }>(res);
    expect(body).toMatchObject({ status: 'approved', decisionComment: 'Enjoy', version: 2 });
    expect(await ledgerTypes(req.id)).toEqual([
      'reservation -1.00',
      'reservation_release 1.00',
      'usage -1.00',
    ]);
    const audit = await auditFor(f.db, req.id);
    expect(audit.map((a) => a.action)).toEqual(['leave_request.created', 'leave_request.approved']);
    expect(audit[1]?.metadata).toMatchObject({ from: 'pending', to: 'approved', onBehalf: false });
    const decided = (await outboxFor(f.db, f.companyId, ['email.request_decided'])).filter((m) =>
      (m.payload as { path: string }).path.endsWith(req.id),
    );
    expect(decided).toHaveLength(1);
    expect(decided[0]?.payload).toMatchObject({ recipientUserId: alice.userId, decision: 'approved' });

    // Same Idempotency-Key: the stored response, no second effect (API-STANDARDS §9).
    const replay = await act(manager, req.id, 'approve', { comment: 'Enjoy', version: req.version }, k);
    expect(replay.status).toBe(200);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await ledgerTypes(req.id)).toHaveLength(3);
    // A new key on an approved request: 409 INVALID_TRANSITION without side effects.
    const again = await act(manager, req.id, 'approve', { version: 2 }, key());
    expect(again.status).toBe(409);
    expect((await json(again)).code).toBe('INVALID_TRANSITION');
  });

  it('requires an Idempotency-Key to approve', async () => {
    const req = await created(alice, { startDate: '2026-06-15', endDate: '2026-06-15' });
    const res = await act(manager, req.id, 'approve', { version: req.version });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('returns 409 VERSION_CONFLICT for a stale version', async () => {
    const req = await created(alice, { startDate: '2026-06-16', endDate: '2026-06-16' });
    const res = await act(manager, req.id, 'approve', { version: req.version + 1 }, key());
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe('VERSION_CONFLICT');
  });

  it('returns 404 to a manager outside the reporting line and to the requester (IDOR)', async () => {
    const req = await created(outsider, { startDate: '2026-06-17', endDate: '2026-06-17' });
    expect((await act(manager, req.id, 'approve', { version: 1 }, key())).status).toBe(404);
    expect((await act(outsider, req.id, 'approve', { version: 1 }, key())).status).toBe(404);
    const otherHr = await other.signIn({ roles: ['hr_admin'] });
    expect((await act(otherHr, req.id, 'approve', { version: 1 }, key())).status).toBe(404);
  });

  it('returns 403 SELF_APPROVAL_FORBIDDEN when HR approves their own request (FR-WF-004)', async () => {
    const req = await created(hr, { startDate: '2026-06-17', endDate: '2026-06-17' });
    const res = await act(hr, req.id, 'approve', { version: req.version }, key());
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('SELF_APPROVAL_FORBIDDEN');
  });

  it('routes a request without a manager to HR (D-014)', async () => {
    const req = await created(manager, { startDate: '2026-06-18', endDate: '2026-06-18' });
    const [step] = await f.db
      .select({ permission: schema.approvalSteps.approverPermission })
      .from(schema.approvalSteps)
      .innerJoin(
        schema.approvalRequests,
        eq(schema.approvalRequests.id, schema.approvalSteps.approvalRequestId),
      )
      .where(eq(schema.approvalRequests.leaveRequestId, req.id));
    expect(step?.permission).toBe('leave.request.review.all');
    const res = await act(hr, req.id, 'approve', { version: req.version }, key());
    expect(res.status).toBe(200);
    expect((await auditFor(f.db, req.id))[1]?.metadata).toMatchObject({ onBehalf: false });
  });

  it('lets HR decide on behalf of the manager and audits it as acted on behalf', async () => {
    const req = await created(bob, { startDate: '2026-06-21', endDate: '2026-06-21' });
    const res = await act(hr, req.id, 'approve', { version: req.version }, key());
    expect(res.status).toBe(200);
    expect((await auditFor(f.db, req.id))[1]?.metadata).toMatchObject({ onBehalf: true });
  });

  it('rejects with a required comment and releases the reservation', async () => {
    const req = await created(bob, { startDate: '2026-06-22', endDate: '2026-06-23' });
    const before = await balance(bob, 'CL');
    const noComment = await act(manager, req.id, 'reject', { version: req.version });
    expect(noComment.status).toBe(400);
    const res = await act(manager, req.id, 'reject', { comment: 'Release week', version: req.version });
    expect(res.status).toBe(200);
    expect((await json<Req>(res)).status).toBe('rejected');
    expect(await ledgerTypes(req.id)).toEqual(['reservation -2.00', 'reservation_release 2.00']);
    const after = await balance(bob, 'CL');
    expect(Number(after?.available) - Number(before?.available)).toBe(2);
    expect((await auditFor(f.db, req.id)).map((a) => a.action)).toContain('leave_request.rejected');
  });
});

describe('withdraw', () => {
  it('lets the requester withdraw a pending request, releasing the reservation', async () => {
    const req = await created(bob, { startDate: '2026-06-24', endDate: '2026-06-24' });
    const res = await act(bob, req.id, 'withdraw', { version: req.version });
    expect(res.status).toBe(200);
    expect((await json<Req>(res)).status).toBe('withdrawn');
    expect(await ledgerTypes(req.id)).toEqual(['reservation -1.00', 'reservation_release 1.00']);
    const [approval] = await f.db
      .select({ state: schema.approvalRequests.state })
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.leaveRequestId, req.id));
    expect(approval?.state).toBe('withdrawn');
    const again = await act(bob, req.id, 'withdraw', { version: 2 });
    expect(again.status).toBe(409);
    expect((await json(again)).code).toBe('INVALID_TRANSITION');
  });

  it("returns 404 when someone else withdraws an employee's request", async () => {
    const req = await created(bob, { startDate: '2026-06-25', endDate: '2026-06-25' });
    expect((await act(alice, req.id, 'withdraw', { version: 1 })).status).toBe(404);
    expect((await act(manager, req.id, 'withdraw', { version: 1 })).status).toBe(404);
  });
});

describe('cancellation', () => {
  it('approved → cancellation_pending → cancelled posts a reversal of the usage (US-LEAVE-005)', async () => {
    const req = await created(alice, { startDate: '2026-07-19', endDate: '2026-07-20' });
    await act(manager, req.id, 'approve', { version: 1 }, key());
    const before = await balance(alice, 'CL');
    const cancel = await act(alice, req.id, 'cancel', { reason: 'Plans changed', version: 2 });
    expect(cancel.status).toBe(200);
    expect(await json(cancel)).toMatchObject({
      status: 'cancellation_pending',
      cancellationReason: 'Plans changed',
    });
    const asks = (await outboxFor(f.db, f.companyId, ['email.approval_requested'])).filter((m) =>
      (m.payload as { path: string }).path.endsWith(req.id),
    );
    expect(asks).toHaveLength(2);

    const done = await act(manager, req.id, 'cancel/approve', { version: 3 }, key());
    expect(done.status).toBe(200);
    expect((await json<Req>(done)).status).toBe('cancelled');
    const rows = await f.db
      .select()
      .from(schema.leaveLedgerEntries)
      .where(eq(schema.leaveLedgerEntries.leaveRequestId, req.id));
    const usage = rows.find((r) => r.type === 'usage');
    const reversal = rows.find((r) => r.type === 'reversal');
    expect(reversal).toMatchObject({ amount: '2.00', reversesEntryId: usage?.id });
    const after = await balance(alice, 'CL');
    expect(Number(after?.available) - Number(before?.available)).toBe(2);
    expect((await auditFor(f.db, req.id)).map((a) => a.action)).toEqual([
      'leave_request.created',
      'leave_request.approved',
      'leave_request.cancellation_requested',
      'leave_request.cancelled',
    ]);
    const decided = (await outboxFor(f.db, f.companyId, ['email.leave_cancellation_decided'])).filter((m) =>
      (m.payload as { path: string }).path.endsWith(req.id),
    );
    expect(decided[0]?.payload).toMatchObject({ recipientUserId: alice.userId, decision: 'approved' });
  });

  it('cancel/reject returns the request to approved with the balance unchanged', async () => {
    const req = await created(alice, { startDate: '2026-07-21', endDate: '2026-07-21' });
    await act(manager, req.id, 'approve', { version: 1 }, key());
    await act(alice, req.id, 'cancel', { version: 2 });
    const before = await balance(alice, 'CL');
    const res = await act(manager, req.id, 'cancel/reject', { comment: 'Needed that day', version: 3 });
    expect(res.status).toBe(200);
    expect((await json<Req>(res)).status).toBe('approved');
    expect(await balance(alice, 'CL')).toEqual(before);
    expect((await auditFor(f.db, req.id)).at(-1)?.action).toBe('leave_request.cancellation_rejected');
  });

  it('returns 422 INVALID_DATE when cancelling leave that has already ended', async () => {
    const req = await created(hr, {
      employeeId: alice.employeeId,
      startDate: '2026-05-12',
      endDate: '2026-05-12',
    });
    expect((await act(manager, req.id, 'approve', { version: 1 }, key())).status).toBe(200);
    const res = await act(alice, req.id, 'cancel', { version: 2 });
    expect(res.status).toBe(422);
    expect((await json(res)).code).toBe('INVALID_DATE');
  });

  it('returns 409 INVALID_TRANSITION when cancelling a pending request or approving a non-pending cancellation', async () => {
    const req = await created(alice, { startDate: '2026-07-22', endDate: '2026-07-22' });
    expect((await act(alice, req.id, 'cancel', { version: 1 })).status).toBe(409);
    expect((await act(manager, req.id, 'cancel/approve', { version: 1 }, key())).status).toBe(409);
  });

  it('lets HR request a cancellation on behalf of the employee', async () => {
    const req = await created(bob, { startDate: '2026-07-23', endDate: '2026-07-23' });
    await act(manager, req.id, 'approve', { version: 1 }, key());
    const res = await act(hr, req.id, 'cancel', { version: 2 });
    expect(res.status).toBe(200);
    expect((await auditFor(f.db, req.id)).at(-1)?.metadata).toMatchObject({ onBehalf: true });
  });
});

describe('GET /leave/requests', () => {
  it('shows the employee only their own requests and the manager the team', async () => {
    const mine = await json<{ data: { employeeId: string }[] }>(
      await call('GET', '/api/v1/leave/requests?pageSize=100', { cookie: alice.cookie, now: NOW }),
    );
    expect(new Set(mine.data.map((r) => r.employeeId))).toEqual(new Set([alice.employeeId]));
    const team = await json<{ data: { employeeId: string }[] }>(
      await call('GET', '/api/v1/leave/requests?pageSize=100', { cookie: manager.cookie, now: NOW }),
    );
    const ids = new Set(team.data.map((r) => r.employeeId));
    expect(ids.has(alice.employeeId as string) && ids.has(bob.employeeId as string)).toBe(true);
    expect(ids.has(outsider.employeeId as string)).toBe(false);
  });

  it('filters by status and rejects unknown query parameters', async () => {
    const res = await call('GET', '/api/v1/leave/requests?status=approved,cancelled', {
      cookie: hr.cookie,
      now: NOW,
    });
    const body = await json<{ data: { status: string }[]; page: { totalItems: number } }>(res);
    expect(body.data.every((r) => ['approved', 'cancelled'].includes(r.status))).toBe(true);
    const bad = await call('GET', '/api/v1/leave/requests?colour=red', { cookie: hr.cookie, now: NOW });
    expect(bad.status).toBe(400);
  });

  it('returns 404 for a request outside the caller scope and for another company', async () => {
    const req = await created(outsider, { startDate: '2026-08-02', endDate: '2026-08-02' });
    expect((await call('GET', `/api/v1/leave/requests/${req.id}`, { cookie: alice.cookie })).status).toBe(
      404,
    );
    expect((await call('GET', `/api/v1/leave/requests/${req.id}`, { cookie: manager.cookie })).status).toBe(
      404,
    );
    const otherHr = await other.signIn({ roles: ['hr_admin'] });
    expect((await call('GET', `/api/v1/leave/requests/${req.id}`, { cookie: otherHr.cookie })).status).toBe(
      404,
    );
    expect((await call('GET', `/api/v1/leave/requests/${req.id}`, { cookie: outsider.cookie })).status).toBe(
      200,
    );
  });

  it('returns 403 to a user with no leave access', async () => {
    const admin = await f.signIn({ roles: ['system_admin'] });
    expect((await call('GET', '/api/v1/leave/requests', { cookie: admin.cookie })).status).toBe(403);
  });
});

describe('GET /leave/calendar', () => {
  it('shows the manager the team with leave types', async () => {
    const res = await call('GET', '/api/v1/leave/calendar?from=2026-06-01&to=2026-07-31', {
      cookie: manager.cookie,
      now: NOW,
    });
    expect(res.status).toBe(200);
    const body = await json<{ data: { employeeId: string; leaveType?: { code: string } }[] }>(res);
    expect(body.data.some((e) => e.employeeId === alice.employeeId && e.leaveType?.code === 'CL')).toBe(true);
    expect(body.data.some((e) => e.employeeId === outsider.employeeId)).toBe(false);
  });

  it("shows an employee only their own leave, and colleagues' approved leave without type when enabled", async () => {
    const own = await json<{ data: { employeeId: string }[] }>(
      await call('GET', '/api/v1/leave/calendar?from=2026-06-01&to=2026-07-31', {
        cookie: bob.cookie,
        now: NOW,
      }),
    );
    expect(new Set(own.data.map((e) => e.employeeId))).toEqual(new Set([bob.employeeId]));

    await f.db
      .update(schema.settings)
      .set({ value: true })
      .where(
        and(
          eq(schema.settings.companyId, f.companyId),
          eq(schema.settings.key, 'leave.calendar.visible_to_team'),
        ),
      );
    const team = await json<{
      data: { employeeId: string; status: string; leaveType?: unknown; requestId?: string }[];
    }>(
      await call('GET', '/api/v1/leave/calendar?from=2026-06-01&to=2026-07-31', {
        cookie: bob.cookie,
        now: NOW,
      }),
    );
    const colleague = team.data.filter((e) => e.employeeId === alice.employeeId);
    expect(colleague.length).toBeGreaterThan(0);
    expect(colleague.every((e) => e.status === 'approved' && !e.leaveType && !e.requestId)).toBe(true);
    expect(team.data.some((e) => e.employeeId === outsider.employeeId)).toBe(false);
  });

  it('returns 400 for a range over 92 days', async () => {
    const res = await call('GET', '/api/v1/leave/calendar?from=2026-01-01&to=2026-06-30', {
      cookie: manager.cookie,
    });
    expect(res.status).toBe(400);
  });
});
