import { schema } from '@hrm/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditFor, call, json, outboxFor, type TestUser } from '../harness';
import {
  approve,
  calculate,
  createRun,
  employee,
  get,
  HOOK_TIMEOUT,
  type Item,
  items,
  key,
  lock,
  m,
  ok,
  period,
  post,
  type Run,
  runTo,
  type Scenario,
  scenario,
  setSetting,
  structure,
  submit,
} from './payroll-helpers';

let s: Scenario;
let other: Scenario;
let hr: TestUser;
let auditor: TestUser;
let staff: TestUser;
let e1: string;

const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

beforeAll(async () => {
  s = await scenario('Payroll runs Co');
  other = await scenario('Payroll other Co');
  hr = await s.f.signIn({ roles: ['hr_admin'] });
  auditor = await s.f.signIn({ roles: ['auditor'] });
  staff = await s.f.signIn({ employee: true, strong: false });
  await structure(s.f, staff.employeeId as string, '20000.00');
  e1 = (await employee(s.f)).id;
  await structure(s.f, e1, '52000.00');
}, HOOK_TIMEOUT);

describe('payroll periods', () => {
  it('computes the dates, refuses duplicates and checks permissions', async () => {
    const p = await period(s, 2028, 2);
    expect(p).toMatchObject({ startDate: '2028-02-01', endDate: '2028-02-29' });
    const dup = await post(s.po, '/payroll/periods', { year: 2028, month: 2 });
    expect(dup.status).toBe(409);
    expect((await json(dup)).code).toBe('DUPLICATE');
    expect((await post(s.po, '/payroll/periods', { year: 2028, month: 13 })).status).toBe(400);
    expect((await post(s.director, '/payroll/periods', { year: 2028, month: 3 })).status).toBe(403);
    expect((await get(auditor, '/payroll/periods')).status).toBe(200);
    expect((await get(staff, '/payroll/periods')).status).toBe(403);
  });
});

describe('POST /payroll/runs', () => {
  it('requires an Idempotency-Key', async () => {
    const p = await period(s, 2027, 3);
    const res = await post(s.po, '/payroll/runs', { periodId: p.id }, {});
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('creates PR-YYYY-MM-01 as draft, replays a retry, refuses a second regular run (PAY-13e)', async () => {
    const p = await period(s, 2027, 4);
    const headers = key();
    const first = await post(s.po, '/payroll/runs', { periodId: p.id }, headers);
    expect(first.status).toBe(201);
    const run = await json<Run>(first);
    expect(run).toMatchObject({ runNumber: 'PR-2027-04-01', status: 'draft', totals: null });
    const retry = await post(s.po, '/payroll/runs', { periodId: p.id }, headers);
    expect(retry.status).toBe(201);
    expect(retry.headers.get('Idempotent-Replayed')).toBe('true');
    expect((await json<Run>(retry)).id).toBe(run.id);
    expect((await auditFor(s.f.db, run.id)).map((a) => a.action)).toEqual(['payroll_run.created']);

    const second = await post(s.po, '/payroll/runs', { periodId: p.id, runType: 'regular' });
    expect(second.status).toBe(409);
    expect((await json(second)).code).toBe('PAYROLL_RUN_EXISTS');
    const off = await ok<Run>(post(s.po, '/payroll/runs', { periodId: p.id, runType: 'off_cycle' }), 201);
    expect(off.runNumber).toBe('PR-2027-04-02');
    // off-cycle calculation: payroll-offcycle.test.ts
  });

  it('returns 403 without payroll.prepare, MFA_REQUIRED on a weak session and 404 for another company period', async () => {
    const p = await period(s, 2027, 5);
    expect((await post(s.director, '/payroll/runs', { periodId: p.id })).status).toBe(403);
    expect((await post(staff, '/payroll/runs', { periodId: p.id })).status).toBe(403);
    const weak = await s.f.signIn({ roles: ['payroll_officer'], strong: false });
    const res = await post(weak, '/payroll/runs', { periodId: p.id });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('MFA_REQUIRED');
    const theirs = await period(other, 2027, 5);
    expect((await post(s.po, '/payroll/runs', { periodId: theirs.id })).status).toBe(404);
    expect((await post(s.po, '/payroll/runs', { periodId: 'not-a-uuid' })).status).toBe(400);
  });

  it('reads: payroll.read.all only; other company runs are 404', async () => {
    const run = await runTo(other, 2027, 6, 'draft');
    expect((await get(s.po, `/payroll/runs/${run.id}`)).status).toBe(404);
    expect((await get(s.po, `/payroll/runs/${run.id}/items`)).status).toBe(404);
    expect((await get(staff, '/payroll/runs')).status).toBe(403);
    expect((await get(hr, '/payroll/runs')).status).toBe(403);
    expect((await get(auditor, '/payroll/runs')).status).toBe(200);
    expect((await get(s.po, '/payroll/runs?status=bogus')).status).toBe(400);
  });
});

describe('PAY-08 duplicate calculate and concurrency (FR-PAY-019)', () => {
  it('a retried key replays without new rows; a new key recalculates identically', async () => {
    const p = await period(s, 2027, 7);
    const run = await createRun(s, p.id);
    const k1 = key();
    const a = await post(s.po, `/payroll/runs/${run.id}/calculate`, { version: run.version }, k1);
    expect(a.status).toBe(200);
    const calculated = await json<Run>(a);
    const b = await post(s.po, `/payroll/runs/${run.id}/calculate`, { version: run.version }, k1);
    expect(b.status).toBe(200);
    expect(b.headers.get('Idempotent-Replayed')).toBe('true');
    const first = await items(s, run.id);
    expect(first).toHaveLength(2);
    expect(
      (await auditFor(s.f.db, run.id)).filter((x) => x.action === 'payroll_run.calculated'),
    ).toHaveLength(1);

    const again = await calculate(s, calculated);
    const second = await items(s, run.id);
    expect(second.map((i) => i.netAmount)).toEqual(first.map((i) => i.netAmount));
    expect(second.map((i) => i.id)).not.toEqual(first.map((i) => i.id));
    expect(again.totals?.net.amount).toBe(calculated.totals?.net.amount);
    expect(again.totals?.net.amount).toBe('72000.00');
    const reused = await post(s.po, `/payroll/runs/${run.id}/calculate`, { version: again.version }, k1);
    expect(reused.status).toBe(409);
    expect((await json(reused)).code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('two parallel calculations with different keys: one succeeds, the other gets 409', async () => {
    const run = await runTo(s, 2027, 8, 'draft');
    const [r1, r2] = await Promise.all([
      post(s.po, `/payroll/runs/${run.id}/calculate`, { version: run.version }),
      post(s.po, `/payroll/runs/${run.id}/calculate`, { version: run.version }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await items(s, run.id)).toHaveLength(2);
  });
});

describe('run transitions (DOMAIN-MODEL 5.6)', () => {
  it('rejects actions from the wrong status with 409 INVALID_TRANSITION and stale versions with VERSION_CONFLICT', async () => {
    const run = await runTo(s, 2027, 9, 'draft');
    const expect409 = async (res: Response, code: string) => {
      expect(res.status).toBe(409);
      expect((await json(res)).code).toBe(code);
    };
    await expect409(
      await post(s.po, `/payroll/runs/${run.id}/submit`, { version: run.version }),
      'INVALID_TRANSITION',
    );
    await expect409(await post(s.po, `/payroll/runs/${run.id}/validate`), 'INVALID_TRANSITION');
    const calc = await calculate(s, run);
    await expect409(
      await post(s.director, `/payroll/runs/${run.id}/approve`, { version: calc.version }),
      'INVALID_TRANSITION',
    );
    await expect409(
      await post(s.po, `/payroll/runs/${run.id}/lock`, { version: calc.version }),
      'INVALID_TRANSITION',
    );
    await expect409(
      await post(s.po, `/payroll/runs/${run.id}/submit`, { version: run.version }),
      'VERSION_CONFLICT',
    );
    const sub = await submit(s, calc);
    await expect409(
      await post(s.po, `/payroll/runs/${run.id}/calculate`, { version: sub.version }),
      'INVALID_TRANSITION',
    );
    const appr = await approve(s, sub);
    await expect409(
      await post(s.po, `/payroll/runs/${run.id}/mark-paid`, { version: appr.version }),
      'INVALID_TRANSITION',
    );
    await expect409(await post(s.po, `/payroll/runs/${run.id}/publish-payslips`), 'INVALID_TRANSITION');
    const locked = await lock(s, appr);
    await expect409(
      await post(s.po, `/payroll/runs/${run.id}/reconcile`, { version: locked.version }),
      'INVALID_TRANSITION',
    );
    await expect409(
      await post(s.po, `/payroll/runs/${run.id}/lock`, { version: locked.version }),
      'INVALID_TRANSITION',
    );
  });

  it('submit opens a payroll.approve step, audits and emails the approvers; return emails the preparer', async () => {
    const run = await runTo(s, 2027, 10, 'calculated');
    const sub = await submit(s, run);
    const [req] = await s.f.db
      .select()
      .from(schema.approvalRequests)
      .where(
        and(eq(schema.approvalRequests.payrollRunId, run.id), eq(schema.approvalRequests.state, 'open')),
      );
    const [step] = await s.f.db
      .select()
      .from(schema.approvalSteps)
      .where(eq(schema.approvalSteps.approvalRequestId, req?.id as string));
    expect(step?.approverPermission).toBe('payroll.approve');
    const mails = (await outboxFor(s.f.db, s.f.companyId, ['email.approval_requested'])).filter((x) =>
      x.dedupeKey?.startsWith(`payroll_run.submitted:${run.id}`),
    );
    expect(mails.map((x) => (x.payload as { recipientUserId: string }).recipientUserId)).toContain(
      s.director.userId,
    );
    expect(JSON.stringify(mails[0]?.payload)).not.toMatch(/52000/);

    expect((await post(s.director, `/payroll/runs/${run.id}/return`, { version: sub.version })).status).toBe(
      400,
    );
    expect(
      (await post(staff, `/payroll/runs/${run.id}/return`, { reason: 'x', version: sub.version })).status,
    ).toBe(403);
    const back = await ok<Run>(
      post(s.director, `/payroll/runs/${run.id}/return`, { reason: 'Check E1', version: sub.version }),
    );
    expect(back).toMatchObject({ status: 'draft', returnedReason: 'Check E1' });
    const returned = (await outboxFor(s.f.db, s.f.companyId, ['email.payroll_run_returned'])).find(
      (x) => (x.payload as { runNumber: string }).runNumber === run.runNumber,
    );
    expect(returned?.payload).toMatchObject({ recipientUserId: s.po.userId, reason: 'Check E1' });
    const audit = (await auditFor(s.f.db, run.id)).map((a) => a.action);
    expect(audit).toEqual([
      'payroll_run.created',
      'payroll_run.calculated',
      'payroll_run.submitted',
      'payroll_run.returned',
    ]);
    expect((await auditFor(s.f.db, run.id)).every((a) => a.category === 'payroll')).toBe(true);
  });

  it('PAY-13f self-approval needs a 20-character note and sets self_approved (D-007)', async () => {
    const run = await runTo(s, 2027, 11, 'submitted');
    const none = await post(s.po, `/payroll/runs/${run.id}/approve`, { version: run.version });
    expect(none.status).toBe(422);
    expect((await json(none)).code).toBe('SELF_APPROVAL_NOTE_REQUIRED');
    const short = await post(s.po, `/payroll/runs/${run.id}/approve`, {
      version: run.version,
      selfApprovalNote: 'ok',
    });
    expect(short.status).toBe(422);
    const note = 'Director on leave; totals checked against bank sheet.';
    const done = await ok<Run>(
      post(s.po, `/payroll/runs/${run.id}/approve`, { version: run.version, selfApprovalNote: note }),
    );
    expect(done).toMatchObject({ status: 'approved', selfApproved: true, selfApprovalNote: note });
    expect(done).toMatchObject({ preparedByName: 'Pat Payroll', approvedByName: 'Pat Payroll' });
    const audit = (await auditFor(s.f.db, run.id)).at(-1);
    expect(audit?.metadata).toMatchObject({ to: 'approved', selfApproved: true, note });
  });

  it('refuses self-approval when payroll.allow_self_approval is off; another approver is not flagged', async () => {
    const run = await runTo(s, 2027, 12, 'submitted');
    await setSetting(s.f, 'payroll.allow_self_approval', false);
    try {
      const res = await post(s.po, `/payroll/runs/${run.id}/approve`, {
        version: run.version,
        selfApprovalNote: 'A long enough justification note.',
      });
      expect(res.status).toBe(403);
      expect((await json(res)).code).toBe('SELF_APPROVAL_FORBIDDEN');
    } finally {
      await setSetting(s.f, 'payroll.allow_self_approval', true);
    }
    const done = await approve(s, run);
    expect(done).toMatchObject({ status: 'approved', selfApproved: false });
    expect(done).toMatchObject({
      preparedBy: s.po.userId,
      preparedByName: 'Pat Payroll',
      approvedBy: s.director.userId,
      approvedByName: 'Dana Director',
    });
    const listed = await ok<{ data: Run[] }>(get(auditor, `/payroll/runs?periodId=${done.period.id}`));
    expect(listed.data[0]).toMatchObject({ preparedByName: 'Pat Payroll', approvedByName: 'Dana Director' });
    const draft = await runTo(s, 2028, 6, 'draft');
    expect(draft).toMatchObject({ preparedByName: 'Pat Payroll', approvedByName: null });
    const decided = (await outboxFor(s.f.db, s.f.companyId, ['email.request_decided'])).find(
      (x) => x.dedupeKey === `payroll_run.approved:${run.id}`,
    );
    expect(decided?.payload).toMatchObject({ recipientUserId: s.po.userId, decision: 'approved' });
  });

  it('approve and lock need a fresh strong session (REAUTH_REQUIRED after 15 minutes)', async () => {
    const run = await runTo(s, 2028, 1, 'submitted');
    const stale = await call('POST', `/api/v1/payroll/runs/${run.id}/approve`, {
      cookie: s.director.cookie,
      body: { version: run.version },
      headers: key(),
      now: later(20),
    });
    expect(stale.status).toBe(403);
    expect((await json(stale)).code).toBe('REAUTH_REQUIRED');
    const appr = await approve(s, run);
    const staleLock = await call('POST', `/api/v1/payroll/runs/${run.id}/lock`, {
      cookie: s.po.cookie,
      body: { version: appr.version },
      headers: key(),
      now: later(20),
    });
    expect(staleLock.status).toBe(403);
    expect((await json(staleLock)).code).toBe('REAUTH_REQUIRED');
    expect((await post(s.director, `/payroll/runs/${run.id}/lock`, { version: appr.version })).status).toBe(
      403,
    );
  });

  it('lock closes the period, freezes the run and audits totals', async () => {
    const run = await runTo(s, 2026, 9, 'locked');
    expect(run.status).toBe('locked');
    const [p] = await s.f.db
      .select()
      .from(schema.payrollPeriods)
      .where(and(eq(schema.payrollPeriods.companyId, s.f.companyId), eq(schema.payrollPeriods.month, 9)));
    expect(p?.status).toBe('closed');
    const audit = (await auditFor(s.f.db, run.id)).at(-1);
    expect(audit).toMatchObject({ action: 'payroll_run.locked', category: 'payroll' });
    expect(audit?.metadata).toMatchObject({ totalNet: '72000.00', employeeCount: 2 });
    const again = await post(s.po, '/payroll/runs', { periodId: p?.id });
    expect(again.status).toBe(409);
  });
});

describe('items and validation', () => {
  it('lists items with flag filters and returns line items with the snapshot', async () => {
    const lateJoiner = await employee(s.f, { joiningDate: '2026-08-11' });
    await structure(s.f, lateJoiner.id, '31000.00', '2026-08-11');
    const run = await runTo(s, 2026, 8, 'calculated');
    const flagged = await ok<{ data: Item[] }>(get(s.po, `/payroll/runs/${run.id}/items?flag=joiner`));
    expect(flagged.data.map((i) => i.employee.id)).toEqual([lateJoiner.id]);
    expect(flagged.data[0]?.netAmount).toEqual(m('21000.00'));
    const detail = await ok<{ snapshot: { ruleVersion: string; daysEmployed: number } }>(
      get(s.po, `/payroll/runs/${run.id}/items/${flagged.data[0]?.id}`),
    );
    expect(detail.snapshot).toMatchObject({ ruleVersion: 'payroll-v1.1', daysEmployed: 21 });
    const otherRun = await runTo(s, 2026, 7, 'calculated');
    expect((await get(s.po, `/payroll/runs/${otherRun.id}/items/${flagged.data[0]?.id}`)).status).toBe(404);
    const v = await ok<{ summary: { blockingCode: string | null; warningItems: number } }>(
      post(s.po, `/payroll/runs/${run.id}/validate`),
    );
    expect(v.summary).toMatchObject({ blockingCode: null, warningItems: 1 });
    expect((await post(s.director, `/payroll/runs/${run.id}/validate`)).status).toBe(403);
  });
});

describe('salary structures (US-PAY-001)', () => {
  it('creates a draft (Strong, compensation.manage) and audits it in the payroll category', async () => {
    const res = await post(s.po, '/salary-structures', {
      employeeId: e1,
      grossAmount: m('60000.00'),
      effectiveFrom: '2029-07-01',
      reason: 'Promotion',
    });
    expect(res.status).toBe(201);
    const st = await json<{ id: string; status: string; grossAmount: unknown }>(res);
    expect(st).toMatchObject({ status: 'draft', grossAmount: m('60000.00') });
    const [audit] = await auditFor(s.f.db, st.id);
    expect(audit).toMatchObject({ action: 'salary_structure.created', category: 'payroll', employeeId: e1 });
  });

  it('validates input and permissions', async () => {
    const bad = await post(s.po, '/salary-structures', {
      employeeId: e1,
      grossAmount: m('-1.00'),
      effectiveFrom: '2029-07-01',
      reason: 'x',
    });
    expect(bad.status).toBe(400);
    const body = { employeeId: e1, grossAmount: m('1.00'), effectiveFrom: '2029-07-01', reason: 'Test' };
    expect((await post(hr, '/salary-structures', body)).status).toBe(403);
    expect((await post(s.director, '/salary-structures', body)).status).toBe(403);
    const foreign = await employee(other.f);
    expect((await post(s.po, '/salary-structures', { ...body, employeeId: foreign.id })).status).toBe(400);
  });

  it('approve closes the previous structure, emits salary_changed and audits old and new amounts', async () => {
    const emp = await employee(s.f, { joiningDate: '2026-01-01' });
    const create = async (gross: string, from: string) =>
      ok<{ id: string; version: number }>(
        post(s.po, '/salary-structures', {
          employeeId: emp.id,
          grossAmount: m(gross),
          effectiveFrom: from,
          reason: 'Pay review',
        }),
        201,
      );
    const first = await create('40000.00', '2026-01-01');
    await ok(post(s.po, `/salary-structures/${first.id}/approve`, { version: first.version }));
    const second = await create('46000.00', '2026-07-01');
    const stale = await post(s.po, `/salary-structures/${second.id}/approve`, {
      version: second.version + 1,
    });
    expect(stale.status).toBe(409);
    const approved = await ok<{ status: string }>(
      post(s.po, `/salary-structures/${second.id}/approve`, { version: second.version }),
    );
    expect(approved.status).toBe('approved');
    const [prev] = await s.f.db
      .select()
      .from(schema.salaryStructures)
      .where(eq(schema.salaryStructures.id, first.id));
    expect(prev?.effectiveTo).toBe('2026-06-30');
    const events = await s.f.db
      .select()
      .from(schema.employmentEvents)
      .where(eq(schema.employmentEvents.employeeId, emp.id));
    expect(events.map((e) => [e.type, e.effectiveDate])).toEqual([
      ['salary_changed', '2026-01-01'],
      ['salary_changed', '2026-07-01'],
    ]);
    expect(JSON.stringify(events[1]?.changes)).not.toMatch(/46000/);
    const audit = (await auditFor(s.f.db, second.id)).at(-1);
    expect(audit).toMatchObject({ action: 'salary_structure.approved', category: 'payroll' });
    expect(audit?.metadata).toMatchObject({ grossAmount: { from: '40000.00', to: '46000.00' } });
    const again = await post(s.po, `/salary-structures/${second.id}/approve`, {
      version: second.version + 1,
    });
    expect(again.status).toBe(409);
    expect((await json(again)).code).toBe('INVALID_TRANSITION');

    const earlier = await create('41000.00', '2026-03-01');
    const refused = await post(s.po, `/salary-structures/${earlier.id}/approve`, {
      version: earlier.version,
    });
    expect(refused.status).toBe(422);

    const fresh = await create('47000.00', '2026-09-01');
    const reauth = await call('POST', `/api/v1/salary-structures/${fresh.id}/approve`, {
      cookie: s.po.cookie,
      body: { version: fresh.version },
      now: later(20),
    });
    expect(reauth.status).toBe(403);
    expect((await json(reauth)).code).toBe('REAUTH_REQUIRED');
  });

  it('scopes reads: all for compensation.read.all, own approved structures for employees', async () => {
    const draft = await ok<{ id: string; version: number }>(
      post(s.po, '/salary-structures', {
        employeeId: staff.employeeId,
        grossAmount: m('99000.00'),
        effectiveFrom: '2030-01-01',
        reason: 'Pending review',
      }),
      201,
    );
    const own = await ok<{ data: { id: string; employee: { id: string }; status: string }[] }>(
      get(staff, '/salary-structures'),
    );
    expect(own.data.length).toBeGreaterThan(0);
    expect(own.data.every((x) => x.employee.id === staff.employeeId && x.status !== 'draft')).toBe(true);
    expect(own.data.map((x) => x.id)).not.toContain(draft.id);
    expect((await ok<{ data: unknown[] }>(get(staff, `/salary-structures?employeeId=${e1}`))).data).toEqual(
      [],
    );
    const all = await ok<{ data: { id: string }[] }>(
      get(hr, `/salary-structures?pageSize=100&employeeId=${staff.employeeId}`),
    );
    expect(all.data.map((x) => x.id)).toContain(draft.id);
    const plain = await s.f.signIn({ strong: false });
    expect((await get(plain, '/salary-structures')).status).toBe(403);
  });
});

describe('payroll adjustments (US-PAY-010, DOMAIN-MODEL 5.7)', () => {
  it('creates pending adjustments with validation and permissions', async () => {
    const p = await period(s, 2029, 1);
    const body = {
      employeeId: e1,
      type: 'deduction',
      amount: m('500.00'),
      reason: 'Advance recovery',
      targetPeriodId: p.id,
    };
    expect((await post(s.po, '/payroll/adjustments', body, {})).status).toBe(400);
    expect((await post(staff, '/payroll/adjustments', body)).status).toBe(403);
    expect((await post(s.director, '/payroll/adjustments', body)).status).toBe(403);
    expect((await post(s.po, '/payroll/adjustments', { ...body, reason: 'x' })).status).toBe(400);
    expect((await post(s.po, '/payroll/adjustments', { ...body, lineCode: 'arrears' })).status).toBe(400);
    const foreign = await employee(other.f);
    expect((await post(s.po, '/payroll/adjustments', { ...body, employeeId: foreign.id })).status).toBe(400);
    const created = await ok<{ id: string; status: string; lineCode: string }>(
      post(s.po, '/payroll/adjustments', body),
      201,
    );
    expect(created).toMatchObject({
      status: 'pending',
      lineCode: 'deduction',
      createdByUserId: s.po.userId,
      createdByName: 'Pat Payroll',
    });
    const list = await ok<{ data: { id: string; createdByUserId: string; createdByName: string }[] }>(
      get(auditor, `/payroll/adjustments?status=pending&periodId=${p.id}`),
    );
    expect(list.data.map((x) => x.id)).toEqual([created.id]);
    expect(list.data[0]).toMatchObject({ createdByUserId: s.po.userId, createdByName: 'Pat Payroll' });
    expect((await get(staff, '/payroll/adjustments')).status).toBe(403);
  });

  it('approval: self needs a note, others do not; reject needs a comment; decided ones are final', async () => {
    const p = await period(s, 2029, 2);
    const mk = () =>
      ok<{ id: string; version: number }>(
        post(s.po, '/payroll/adjustments', {
          employeeId: e1,
          type: 'addition',
          amount: m('750.00'),
          reason: 'Overtime allowance',
          targetPeriodId: p.id,
        }),
        201,
      );
    const a = await mk();
    const self = await post(s.po, `/payroll/adjustments/${a.id}/approve`, { version: a.version });
    expect(self.status).toBe(422);
    expect((await json(self)).code).toBe('SELF_APPROVAL_NOTE_REQUIRED');
    const approved = await ok<{ status: string; selfApproved: boolean }>(
      post(s.po, `/payroll/adjustments/${a.id}/approve`, {
        version: a.version,
        selfApprovalNote: 'Approved in the weekly payroll meeting.',
      }),
    );
    expect(approved).toMatchObject({ status: 'approved', selfApproved: true });
    const twice = await post(s.director, `/payroll/adjustments/${a.id}/reject`, {
      comment: 'late',
      version: a.version + 1,
    });
    expect(twice.status).toBe(409);

    const b = await mk();
    expect(
      (await post(s.director, `/payroll/adjustments/${b.id}/reject`, { version: b.version })).status,
    ).toBe(400);
    expect(
      (await post(staff, `/payroll/adjustments/${b.id}/reject`, { comment: 'no', version: b.version }))
        .status,
    ).toBe(403);
    const rejected = await ok<{ status: string }>(
      post(s.director, `/payroll/adjustments/${b.id}/reject`, { comment: 'Not agreed', version: b.version }),
    );
    expect(rejected.status).toBe('rejected');
    expect((await auditFor(s.f.db, b.id)).map((x) => x.action)).toEqual([
      'payroll_adjustment.created',
      'payroll_adjustment.rejected',
    ]);

    const c = await mk();
    const reauth = await call('POST', `/api/v1/payroll/adjustments/${c.id}/approve`, {
      cookie: s.director.cookie,
      body: { version: c.version },
      now: later(20),
    });
    expect(reauth.status).toBe(403);
    const theirs = await runTo(other, 2029, 3, 'draft');
    expect((await post(s.director, `/payroll/adjustments/${theirs.id}/approve`, { version: 1 })).status).toBe(
      404,
    );
  });
});
