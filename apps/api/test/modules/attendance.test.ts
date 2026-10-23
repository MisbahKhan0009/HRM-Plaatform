import { schema, uuidv7 } from '@hrm/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditFor, call, type Fixture, json, outboxFor, setupCompany, type TestUser } from '../harness';

// Dhaka is UTC+6: 03:00Z is 09:00 local. 4 Oct 2026 is a Sunday. Dates are in the past so test sessions do not hit the idle timeout (working day on the default Sun–Thu schedule).

let f: Fixture;
let other: Fixture;
let hr: TestUser; // hr_admin without an employee record
let hrEmp: TestUser; // hr_admin who is also an employee
let mgr: TestUser;
let emp: TestUser; // reports to mgr
let loner: TestUser; // no manager: corrections go to HR
let mgr2: TestUser; // a manager of someone else
let auditor: TestUser;

type Rec = { status: string; workedMinutes: number; needsReview: boolean; employee: { id: string } };
type Punch = {
  event: { type: string; source: string; userAgent: string | null; workDate: string };
  record: Rec;
};
type Problem = { code: string; errors: { path: string }[] };

const P = '/api/v1/attendance';

beforeAll(async () => {
  f = await setupCompany('Attendance Co');
  other = await setupCompany('Other Attendance Co');
  hr = await f.signIn({ roles: ['hr_admin'] });
  hrEmp = await f.signIn({ roles: ['hr_admin'], employee: true });
  mgr = await f.signIn({ employee: true });
  emp = await f.signIn({ employee: { managerId: mgr.employeeId } });
  loner = await f.signIn({ employee: true });
  mgr2 = await f.signIn({ employee: true });
  await f.employee({ managerId: mgr2.employeeId });
  auditor = await f.signIn({ roles: ['auditor'] });
}, 120_000);

describe('check-in and check-out', () => {
  it('records a check-in for the session employee, ignoring any employeeId in the body', async () => {
    const res = await call('POST', `${P}/check-in`, {
      cookie: emp.cookie,
      body: { employeeId: loner.employeeId },
      now: '2026-10-04T03:00:00Z',
      headers: { 'User-Agent': 'TestBrowser/1.0' },
    });
    expect(res.status).toBe(201);
    const body = await json<Punch>(res);
    expect(body.event).toMatchObject({
      type: 'check_in',
      source: 'web',
      userAgent: 'TestBrowser/1.0',
      workDate: '2026-10-04',
    });
    expect(body.record).toMatchObject({ status: 'missing_punch', employee: { id: emp.employeeId } });
  });

  it('returns 409 ALREADY_CHECKED_IN for a second check-in', async () => {
    const res = await call('POST', `${P}/check-in`, { cookie: emp.cookie, now: '2026-10-04T04:00:00Z' });
    expect(res.status).toBe(409);
    expect((await json<Problem>(res)).code).toBe('ALREADY_CHECKED_IN');
  });

  it('checks out and recomputes the day', async () => {
    const res = await call('POST', `${P}/check-out`, { cookie: emp.cookie, now: '2026-10-04T12:30:00Z' });
    expect(res.status).toBe(201);
    expect((await json<Punch>(res)).record).toMatchObject({ status: 'present', workedMinutes: 570 });
  });

  it('returns 409 NOT_CHECKED_IN without an open check-in', async () => {
    const res = await call('POST', `${P}/check-out`, { cookie: emp.cookie, now: '2026-10-04T12:40:00Z' });
    expect(res.status).toBe(409);
    expect((await json<Problem>(res)).code).toBe('NOT_CHECKED_IN');
  });

  it('accepts a second pair on the same day and sums the pairs', async () => {
    expect(
      (await call('POST', `${P}/check-in`, { cookie: emp.cookie, now: '2026-10-04T13:00:00Z' })).status,
    ).toBe(201);
    const out = await call('POST', `${P}/check-out`, { cookie: emp.cookie, now: '2026-10-04T13:30:00Z' });
    expect((await json<Punch>(out)).record.workedMinutes).toBe(600);
  });

  it('attaches a check-out after midnight to the check-in date and flags it for review', async () => {
    const u = await f.signIn({ employee: true });
    await call('POST', `${P}/check-in`, { cookie: u.cookie, now: '2026-10-05T14:00:00Z' });
    const res = await call('POST', `${P}/check-out`, { cookie: u.cookie, now: '2026-10-05T18:30:00Z' });
    const body = await json<Punch>(res);
    expect(body.event.workDate).toBe('2026-10-05');
    expect(body.record).toMatchObject({ needsReview: true, workedMinutes: 270 });
  });

  it('treats a check-in older than the checkout window as stale', async () => {
    const u = await f.signIn({ employee: true });
    await call('POST', `${P}/check-in`, { cookie: u.cookie, now: '2026-10-05T03:00:00Z' });
    const late = await call('POST', `${P}/check-out`, { cookie: u.cookie, now: '2026-10-05T19:00:01Z' });
    expect((await json<Problem>(late)).code).toBe('NOT_CHECKED_IN');
  });

  it('returns 403 to a user without an employee record', async () => {
    const res = await call('POST', `${P}/check-in`, { cookie: hr.cookie, now: '2026-10-04T03:00:00Z' });
    expect(res.status).toBe(403);
  });

  it('returns 401 without a session', async () => {
    expect((await call('POST', `${P}/check-in`, { body: {} })).status).toBe(401);
  });

  it('rate-limits punches to 10 per minute per user', async () => {
    const u = await f.signIn({ employee: true });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++)
      statuses.push(
        (await call('POST', `${P}/check-out`, { cookie: u.cookie, now: '2026-10-04T05:00:00Z' })).status,
      );
    expect(statuses.slice(0, 10).every((s) => s === 409)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('reading attendance', () => {
  it('returns own records and today state on /attendance/me', async () => {
    const res = await call('GET', `${P}/me?from=2026-10-04&to=2026-10-31`, {
      cookie: emp.cookie,
      now: '2026-10-04T14:00:00Z',
    });
    expect(res.status).toBe(200);
    const body = await json<{
      data: Rec[];
      today: { workDate: string; state: string; schedule: { coreStart: string; isWorkingDay: boolean } };
    }>(res);
    expect(body.data.every((r) => r.employee.id === emp.employeeId)).toBe(true);
    expect(body.today).toMatchObject({
      workDate: '2026-10-04',
      state: 'checked_out',
      schedule: { coreStart: '10:00', isWorkingDay: true },
    });
  });

  it('rejects a range over 366 days with 400', async () => {
    const res = await call('GET', `${P}/me?from=2025-01-01&to=2026-10-31`, { cookie: emp.cookie });
    expect(res.status).toBe(400);
  });

  it('requires from and to on the records list', async () => {
    const res = await call('GET', `${P}?from=2026-10-04`, { cookie: hr.cookie });
    expect(res.status).toBe(400);
    expect((await json<Problem>(res)).errors[0]?.path).toBe('query/to');
  });

  it('lists all records to HR and only the team to a manager', async () => {
    await call('POST', `${P}/check-in`, { cookie: loner.cookie, now: '2026-10-04T03:00:00Z' });
    const all = await json<{ data: Rec[] }>(
      await call('GET', `${P}?from=2026-10-04&to=2026-10-04`, { cookie: hr.cookie }),
    );
    const ids = all.data.map((r) => r.employee.id);
    expect(ids).toEqual(expect.arrayContaining([emp.employeeId, loner.employeeId]));
    const team = await json<{ data: Rec[] }>(
      await call('GET', `${P}?from=2026-10-04&to=2026-10-04`, { cookie: mgr.cookie }),
    );
    expect(team.data.map((r) => r.employee.id)).toEqual([emp.employeeId]);
    const filtered = await json<{ data: Rec[] }>(
      await call('GET', `${P}?from=2026-10-04&to=2026-10-04&status=missing_punch`, { cookie: hr.cookie }),
    );
    expect(filtered.data.every((r) => r.status === 'missing_punch')).toBe(true);
  });

  it('returns 403 on the records list to an employee', async () => {
    const res = await call('GET', `${P}?from=2026-10-04&to=2026-10-04`, { cookie: emp.cookie });
    expect(res.status).toBe(403);
  });

  it('returns a day with all its events to the employee, the manager and HR', async () => {
    for (const u of [emp, mgr, hr]) {
      const res = await call('GET', `${P}/${emp.employeeId}/2026-10-04`, { cookie: u.cookie });
      expect(res.status).toBe(200);
      const body = await json<{ events: { type: string }[]; record: Rec }>(res);
      expect(body.events.map((e) => e.type)).toEqual(['check_in', 'check_out', 'check_in', 'check_out']);
    }
  });

  it('returns 404 for a day outside the caller scope (IDOR)', async () => {
    expect((await call('GET', `${P}/${loner.employeeId}/2026-10-04`, { cookie: emp.cookie })).status).toBe(
      404,
    );
    expect((await call('GET', `${P}/${loner.employeeId}/2026-10-04`, { cookie: mgr2.cookie })).status).toBe(
      404,
    );
    const otherHr = await other.signIn({ roles: ['hr_admin'] });
    expect((await call('GET', `${P}/${emp.employeeId}/2026-10-04`, { cookie: otherHr.cookie })).status).toBe(
      404,
    );
  });

  it('summarises counts per status per employee in scope', async () => {
    const res = await call('GET', `${P}/summary?from=2026-10-04&to=2026-10-31&employeeId=${emp.employeeId}`, {
      cookie: hr.cookie,
    });
    expect(res.status).toBe(200);
    const body = await json<{ data: { employee: { id: string }; counts: Record<string, number> }[] }>(res);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.counts.present).toBeGreaterThanOrEqual(1);
    const own = await json<{ data: { employee: { id: string } }[] }>(
      await call('GET', `${P}/summary?from=2026-10-04&to=2026-10-31`, { cookie: loner.cookie }),
    );
    expect(own.data.map((r) => r.employee.id)).toEqual([loner.employeeId]);
  });

  it('returns 403 on the summary to a user without attendance read access', async () => {
    const u = await f.signIn({ roles: ['system_admin'] });
    const res = await call('GET', `${P}/summary?from=2026-10-04&to=2026-10-31`, { cookie: u.cookie });
    expect(res.status).toBe(403);
  });
});

describe('manual entries', () => {
  it('lets HR record a manual entry with a reason, recomputes the day and audits it', async () => {
    const res = await call('POST', `${P}/manual-entries`, {
      cookie: hr.cookie,
      now: '2026-10-08T05:00:00Z',
      body: {
        employeeId: loner.employeeId,
        workDate: '2026-10-06',
        checkInAt: '2026-10-06T03:00:00Z',
        checkOutAt: '2026-10-06T12:00:00Z',
        reason: 'Card reader was down',
      },
    });
    expect(res.status).toBe(201);
    const body = await json<{
      record: Rec & { hasManualEntry: boolean };
      events: { id: string; source: string }[];
    }>(res);
    expect(body.record).toMatchObject({ status: 'present', workedMinutes: 540, hasManualEntry: true });
    const event = body.events.find((e) => e.source === 'manual');
    expect((await auditFor(f.db, event?.id ?? '')).map((a) => a.action)).toEqual([
      'attendance.manual_entry_created',
    ]);
  });

  it('returns 400 when the reason is missing', async () => {
    const res = await call('POST', `${P}/manual-entries`, {
      cookie: hr.cookie,
      body: {
        employeeId: loner.employeeId,
        workDate: '2026-10-06',
        checkInAt: '2026-10-06T03:00:00Z',
        checkOutAt: '2026-10-06T12:00:00Z',
      },
    });
    expect(res.status).toBe(400);
    expect((await json<Problem>(res)).errors[0]?.path).toBe('/reason');
  });

  it('returns 422 INVALID_DATE for a future date', async () => {
    const res = await call('POST', `${P}/manual-entries`, {
      cookie: hr.cookie,
      now: '2026-10-04T05:00:00Z',
      body: {
        employeeId: loner.employeeId,
        workDate: '2026-10-13',
        checkInAt: '2026-10-13T03:00:00Z',
        checkOutAt: '2026-10-13T12:00:00Z',
        reason: 'Planned in advance',
      },
    });
    expect(res.status).toBe(422);
    expect((await json<Problem>(res)).code).toBe('INVALID_DATE');
  });

  it('returns 403 to an employee and 400 for an employee of another company', async () => {
    const input = {
      employeeId: loner.employeeId,
      workDate: '2026-10-06',
      checkInAt: '2026-10-06T03:00:00Z',
      checkOutAt: '2026-10-06T12:00:00Z',
      reason: 'Card reader was down',
    };
    expect((await call('POST', `${P}/manual-entries`, { cookie: emp.cookie, body: input })).status).toBe(403);
    const stranger = await other.employee();
    const res = await call('POST', `${P}/manual-entries`, {
      cookie: hr.cookie,
      now: '2026-10-08T05:00:00Z',
      body: { ...input, employeeId: stranger },
    });
    expect(res.status).toBe(400);
  });
});

type Correction = { id: string; status: string; version: number; employee: { id: string } };

async function requestCorrection(u: TestUser, workDate: string, body: Record<string, unknown>, now: string) {
  return call('POST', `${P}/corrections`, {
    cookie: u.cookie,
    now,
    body: { workDate, reason: 'Forgot to check out', ...body },
  });
}

describe('corrections', () => {
  let pending: Correction;

  it('creates a pending correction, opens an approval for the manager and queues an email', async () => {
    await call('POST', `${P}/check-in`, { cookie: emp.cookie, now: '2026-10-07T03:30:00Z' });
    const res = await requestCorrection(
      emp,
      '2026-10-07',
      { proposedCheckOutAt: '2026-10-07T12:30:00Z' },
      '2026-10-08T04:00:00Z',
    );
    expect(res.status).toBe(201);
    pending = await json<Correction>(res);
    expect(pending).toMatchObject({ status: 'pending', employee: { id: emp.employeeId } });
    expect((await auditFor(f.db, pending.id)).map((a) => a.action)).toEqual([
      'attendance_correction.requested',
    ]);
    const [approval] = await f.db
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.attendanceCorrectionId, pending.id));
    expect(approval?.state).toBe('open');
    const mails = await outboxFor(f.db, f.companyId, ['email.approval_requested']);
    expect(mails.some((m) => (m.payload as { recipientUserId: string }).recipientUserId === mgr.userId)).toBe(
      true,
    );
  });

  it('returns 409 DUPLICATE for a second pending correction of the same day', async () => {
    const res = await requestCorrection(
      emp,
      '2026-10-07',
      { proposedCheckOutAt: '2026-10-07T12:00:00Z' },
      '2026-10-08T04:00:00Z',
    );
    expect(res.status).toBe(409);
    expect((await json<Problem>(res)).code).toBe('DUPLICATE');
  });

  it('validates the reason and the proposed times', async () => {
    const short = await requestCorrection(
      emp,
      '2026-10-05',
      { proposedCheckOutAt: '2026-10-05T12:00:00Z', reason: '' },
      '2026-10-08T04:00:00Z',
    );
    expect(short.status).toBe(400);
    expect((await json<Problem>(short)).errors[0]?.path).toBe('/reason');
    const none = await requestCorrection(emp, '2026-10-05', {}, '2026-10-08T04:00:00Z');
    expect(none.status).toBe(400);
    const wrongDay = await requestCorrection(
      emp,
      '2026-10-05',
      { proposedCheckInAt: '2026-10-06T03:00:00Z' },
      '2026-10-08T04:00:00Z',
    );
    expect(wrongDay.status).toBe(400);
  });

  it('returns 422 INVALID_DATE for a future date or one outside the correction window', async () => {
    const future = await requestCorrection(
      emp,
      '2026-10-13',
      { proposedCheckInAt: '2026-10-13T03:00:00Z' },
      '2026-10-08T04:00:00Z',
    );
    expect((await json<Problem>(future)).code).toBe('INVALID_DATE');
    const old = await requestCorrection(
      emp,
      '2026-10-04',
      { proposedCheckInAt: '2026-10-04T03:00:00Z' },
      '2026-10-15T04:00:00Z',
    );
    expect(old.status).toBe(422);
    expect((await json<Problem>(old)).code).toBe('INVALID_DATE');
  });

  it('returns 403 to a user without an employee record', async () => {
    const res = await requestCorrection(
      hr,
      '2026-10-05',
      { proposedCheckInAt: '2026-10-05T03:00:00Z' },
      '2026-10-08T04:00:00Z',
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 to a manager outside the reporting line and to the employee (IDOR)', async () => {
    for (const u of [mgr2, emp, loner]) {
      const res = await call('POST', `${P}/corrections/${pending.id}/approve`, {
        cookie: u.cookie,
        body: { version: pending.version },
      });
      expect(res.status).toBe(404);
    }
  });

  it('returns 409 VERSION_CONFLICT for a stale version', async () => {
    const res = await call('POST', `${P}/corrections/${pending.id}/approve`, {
      cookie: mgr.cookie,
      body: { version: pending.version + 1 },
    });
    expect(res.status).toBe(409);
    expect((await json<Problem>(res)).code).toBe('VERSION_CONFLICT');
  });

  it('lets the manager approve: appends a correction event, keeps the original and recomputes', async () => {
    const res = await call('POST', `${P}/corrections/${pending.id}/approve`, {
      cookie: mgr.cookie,
      now: '2026-10-08T06:00:00Z',
      body: { version: pending.version, comment: 'OK' },
    });
    expect(res.status).toBe(200);
    expect((await json<Correction>(res)).status).toBe('approved');
    const day = await json<{ events: { type: string }[]; record: Rec & { hasCorrection: boolean } }>(
      await call('GET', `${P}/${emp.employeeId}/2026-10-07`, { cookie: emp.cookie }),
    );
    expect(day.events.map((e) => e.type)).toEqual(['check_in', 'correction']);
    expect(day.record).toMatchObject({ status: 'present', workedMinutes: 540, hasCorrection: true });
    expect((await auditFor(f.db, pending.id)).map((a) => a.action)).toEqual([
      'attendance_correction.requested',
      'attendance_correction.approved',
    ]);
    const decided = await outboxFor(f.db, f.companyId, ['email.request_decided']);
    expect(decided.some((m) => m.dedupeKey === `attendance_correction.approved:${pending.id}`)).toBe(true);
  });

  it('returns 409 INVALID_TRANSITION when approving again', async () => {
    const res = await call('POST', `${P}/corrections/${pending.id}/approve`, {
      cookie: mgr.cookie,
      body: { version: pending.version + 1 },
    });
    expect(res.status).toBe(409);
    expect((await json<Problem>(res)).code).toBe('INVALID_TRANSITION');
  });

  it('returns one correction to the requester, the manager and HR', async () => {
    for (const u of [emp, mgr, hr]) {
      const res = await call('GET', `${P}/corrections/${pending.id}`, { cookie: u.cookie });
      expect(res.status).toBe(200);
      expect(await json<Correction>(res)).toMatchObject({
        id: pending.id,
        status: 'approved',
        employee: { id: emp.employeeId },
      });
    }
  });

  it('returns 404 for a correction outside the caller scope (IDOR) and 403 without access', async () => {
    for (const u of [mgr2, loner]) {
      expect((await call('GET', `${P}/corrections/${pending.id}`, { cookie: u.cookie })).status).toBe(404);
    }
    expect((await call('GET', `${P}/corrections/${pending.id}`, { cookie: auditor.cookie })).status).toBe(
      403,
    );
    expect((await call('GET', `${P}/corrections/${pending.id}`)).status).toBe(401);
  });

  it('returns 400 for a malformed correction id', async () => {
    const res = await call('GET', `${P}/corrections/not-a-uuid`, { cookie: hr.cookie });
    expect(res.status).toBe(400);
  });

  it('requires a comment to reject, and lets HR reject on behalf of the manager', async () => {
    const created = await json<Correction>(
      await requestCorrection(
        emp,
        '2026-10-06',
        { proposedCheckInAt: '2026-10-06T03:00:00Z', proposedCheckOutAt: '2026-10-06T12:00:00Z' },
        '2026-10-08T04:00:00Z',
      ),
    );
    const noComment = await call('POST', `${P}/corrections/${created.id}/reject`, {
      cookie: hr.cookie,
      body: { version: created.version },
    });
    expect(noComment.status).toBe(400);
    const res = await call('POST', `${P}/corrections/${created.id}/reject`, {
      cookie: hr.cookie,
      body: { version: created.version, comment: 'No evidence' },
    });
    expect(res.status).toBe(200);
    expect((await json<Correction>(res)).status).toBe('rejected');
    const audit = await auditFor(f.db, created.id);
    expect(audit.map((a) => a.action)).toContain('attendance_correction.rejected');
    expect(audit.find((a) => a.action === 'attendance_correction.rejected')?.metadata).toMatchObject({
      onBehalf: true,
    });
  });

  it('forbids HR from deciding their own correction (SELF_APPROVAL_FORBIDDEN) and routes it to HR', async () => {
    const created = await json<Correction>(
      await requestCorrection(
        hrEmp,
        '2026-10-07',
        { proposedCheckInAt: '2026-10-07T03:00:00Z', proposedCheckOutAt: '2026-10-07T12:00:00Z' },
        '2026-10-08T04:00:00Z',
      ),
    );
    const self = await call('POST', `${P}/corrections/${created.id}/approve`, {
      cookie: hrEmp.cookie,
      body: { version: created.version },
    });
    expect(self.status).toBe(403);
    expect((await json<Problem>(self)).code).toBe('SELF_APPROVAL_FORBIDDEN');
    const [step] = await f.db
      .select({ permission: schema.approvalSteps.approverPermission })
      .from(schema.approvalSteps)
      .innerJoin(
        schema.approvalRequests,
        eq(schema.approvalRequests.id, schema.approvalSteps.approvalRequestId),
      )
      .where(eq(schema.approvalRequests.attendanceCorrectionId, created.id));
    expect(step?.permission).toBe('attendance.correction.review.all');
    const ok = await call('POST', `${P}/corrections/${created.id}/approve`, {
      cookie: hr.cookie,
      now: '2026-10-08T06:00:00Z',
      body: { version: created.version },
    });
    expect(ok.status).toBe(200);
  });

  it('lets the requester withdraw a pending correction once', async () => {
    const created = await json<Correction>(
      await requestCorrection(
        loner,
        '2026-10-05',
        { proposedCheckInAt: '2026-10-05T03:00:00Z' },
        '2026-10-08T04:00:00Z',
      ),
    );
    const byOther = await call('POST', `${P}/corrections/${created.id}/withdraw`, {
      cookie: emp.cookie,
      body: { version: created.version },
    });
    expect(byOther.status).toBe(404);
    const res = await call('POST', `${P}/corrections/${created.id}/withdraw`, {
      cookie: loner.cookie,
      body: { version: created.version },
    });
    expect(res.status).toBe(200);
    expect((await json<Correction>(res)).status).toBe('withdrawn');
    const again = await call('POST', `${P}/corrections/${created.id}/withdraw`, {
      cookie: loner.cookie,
      body: { version: created.version + 1 },
    });
    expect((await json<Problem>(again)).code).toBe('INVALID_TRANSITION');
    const [approval] = await f.db
      .select({ state: schema.approvalRequests.state })
      .from(schema.approvalRequests)
      .where(
        and(
          eq(schema.approvalRequests.companyId, f.companyId),
          eq(schema.approvalRequests.attendanceCorrectionId, created.id),
        ),
      );
    expect(approval?.state).toBe('withdrawn');
    expect((await auditFor(f.db, created.id)).map((a) => a.action)).toContain(
      'attendance_correction.withdrawn',
    );
  });

  it('lists own corrections to an employee, team ones to a manager and all to HR', async () => {
    const own = await json<{ data: Correction[] }>(
      await call('GET', `${P}/corrections`, { cookie: emp.cookie }),
    );
    expect(own.data.length).toBeGreaterThan(0);
    expect(own.data.every((c) => c.employee.id === emp.employeeId)).toBe(true);
    const team = await json<{ data: Correction[] }>(
      await call('GET', `${P}/corrections`, { cookie: mgr.cookie }),
    );
    expect(team.data.every((c) => c.employee.id === emp.employeeId)).toBe(true);
    const all = await json<{ data: Correction[] }>(
      await call('GET', `${P}/corrections?status=withdrawn`, { cookie: hr.cookie }),
    );
    expect(all.data.map((c) => c.employee.id)).toContain(loner.employeeId);
    expect(all.data.every((c) => c.status === 'withdrawn')).toBe(true);
    expect((await call('GET', `${P}/corrections`, { cookie: auditor.cookie })).status).toBe(403);
  });
});

describe('ids', () => {
  it('returns 404 for an unknown correction', async () => {
    const res = await call('POST', `${P}/corrections/${uuidv7()}/approve`, {
      cookie: hr.cookie,
      body: { version: 1 },
    });
    expect(res.status).toBe(404);
    expect((await call('GET', `${P}/corrections/${uuidv7()}`, { cookie: hr.cookie })).status).toBe(404);
  });

  it('hides another company correction from HR (404)', async () => {
    const [own] = (
      await json<{ data: { id: string }[] }>(await call('GET', `${P}/corrections`, { cookie: hr.cookie }))
    ).data;
    const otherHr = await other.signIn({ roles: ['hr_admin'] });
    expect(own).toBeDefined();
    const res = await call('GET', `${P}/corrections/${own?.id}`, { cookie: otherHr.cookie });
    expect(res.status).toBe(404);
  });
});
