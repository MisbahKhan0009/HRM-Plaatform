import { schema } from '@hrm/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditFor, call, type Fixture, json, outboxFor, setupCompany, type TestUser } from '../harness';

type Pcr = {
  id: string;
  status: string;
  version: number;
  employee: { id: string };
  changes: Record<string, { from: unknown; to: unknown }>;
  decisionComment: string | null;
};

let f: Fixture;
let hr: TestUser;
let hrEmployee: TestUser;

const request = async (user: TestUser, changes: Record<string, unknown>, reason?: string) =>
  call('POST', '/api/v1/profile-change-requests', {
    cookie: user.cookie,
    body: { changes, ...(reason ? { reason } : {}) },
  });

const act = (id: string, action: string, body: unknown, cookie: string) =>
  call('POST', `/api/v1/profile-change-requests/${id}/${action}`, { cookie, body });

beforeAll(async () => {
  f = await setupCompany('Profile Co');
  hr = await f.signIn({ roles: ['hr_admin'] });
  hrEmployee = await f.signIn({ roles: ['hr_admin'], employee: true });
}, 30_000);

describe('POST /profile-change-requests (US-EMP-008)', () => {
  it('creates a pending request from the session, opens an approval for HR and emails them', async () => {
    const me = await f.signIn({ employee: true, strong: false });
    const res = await request(
      me,
      {
        preferredName: 'Rumi',
        emergencyContacts: [{ name: 'Ayesha', relationship: 'Sister', phone: '+8801800000000' }],
      },
      'Married',
    );
    expect(res.status).toBe(201);
    const pcr = await json<Pcr>(res);
    expect(pcr).toMatchObject({ status: 'pending', employee: { id: me.employeeId } });
    expect(pcr.changes.preferredName).toEqual({ from: null, to: 'Rumi' });

    const [approval] = await f.db
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.profileChangeRequestId, pcr.id));
    expect(approval).toMatchObject({
      subjectType: 'profile_change',
      state: 'open',
      requesterUserId: me.userId,
    });
    const [step] = await f.db
      .select()
      .from(schema.approvalSteps)
      .where(eq(schema.approvalSteps.approvalRequestId, approval?.id as string));
    expect(step?.approverPermission).toBe('profile_change.review.all');

    const mails = (await outboxFor(f.db, f.companyId, ['email.approval_requested'])).filter((m) =>
      String(m.dedupeKey).includes(pcr.id),
    );
    expect(mails.map((m) => (m.payload as { recipientUserId: string }).recipientUserId).sort()).toEqual(
      [hr.userId, hrEmployee.userId].sort(),
    );
    expect(JSON.stringify(mails)).not.toContain('Ayesha');
    const audit = await auditFor(f.db, pcr.id);
    expect(audit.map((a) => [a.action, a.metadata])).toEqual([
      ['profile_change.requested', { fields: ['preferredName', 'emergencyContacts'] }],
    ]);

    const second = await request(me, { lastName: 'Other' });
    expect(second.status).toBe(409);
    expect((await json(second)).code).toBe('DUPLICATE');
  });

  it('refuses fields outside the allow-list and requests that change nothing (400)', async () => {
    const me = await f.signIn({ employee: true, strong: false });
    for (const changes of [
      { employeeCode: 'X-1' },
      { departmentId: crypto.randomUUID() },
      { salary: '1' },
      {},
    ]) {
      expect((await request(me, changes)).status).toBe(400);
    }
    const same = await request(me, { firstName: 'Test' });
    expect(same.status).toBe(400);
    expect((await json<{ errors: { code: string }[] }>(same)).errors[0]?.code).toBe('no_changes');
  });

  it('returns 403 to a user without profile_change.request.own', async () => {
    expect((await request(hr, { preferredName: 'X' })).status).toBe(403);
  });
});

describe('deciding a profile change', () => {
  it('applies approved changes in the same transaction and notifies the requester', async () => {
    const me = await f.signIn({ employee: true, strong: false });
    const pcr = await json<Pcr>(
      await request(me, {
        preferredName: 'Bonnie',
        nationalIdNumber: '19901234567',
        personalPhone: '+8801711111111',
      }),
    );
    const res = await act(pcr.id, 'approve', { comment: 'Verified', version: pcr.version }, hr.cookie);
    expect(res.status).toBe(200);
    expect(await json<Pcr>(res)).toMatchObject({ status: 'approved', decisionComment: 'Verified' });

    const [emp] = await f.db
      .select()
      .from(schema.employees)
      .where(eq(schema.employees.id, me.employeeId as string));
    expect(emp?.preferredName).toBe('Bonnie');
    const contact = await json<{ nationalIdNumber: string; personalPhone: string }>(
      await call('GET', `/api/v1/employees/${me.employeeId}/contact`, { cookie: me.cookie }),
    );
    expect(contact).toMatchObject({ nationalIdNumber: '19901234567', personalPhone: '+8801711111111' });

    const audit = await auditFor(f.db, pcr.id);
    expect(audit.map((a) => a.action)).toEqual(['profile_change.requested', 'profile_change.approved']);
    expect(JSON.stringify(audit)).not.toContain('19901234567');
    const decided = await outboxFor(f.db, f.companyId, ['email.request_decided']);
    expect(decided.some((m) => m.dedupeKey === `profile_change.decided:${pcr.id}`)).toBe(true);

    const again = await act(pcr.id, 'approve', { version: pcr.version + 1 }, hr.cookie);
    expect(again.status).toBe(409);
    expect((await json(again)).code).toBe('INVALID_TRANSITION');
  });

  it('rejects with a required comment and changes nothing', async () => {
    const me = await f.signIn({ employee: true, strong: false });
    const pcr = await json<Pcr>(await request(me, { lastName: 'Changed' }));
    expect((await act(pcr.id, 'reject', { version: pcr.version }, hr.cookie)).status).toBe(400);
    const stale = await act(pcr.id, 'reject', { comment: 'No', version: pcr.version + 5 }, hr.cookie);
    expect(stale.status).toBe(409);
    expect((await json(stale)).code).toBe('VERSION_CONFLICT');
    const res = await act(
      pcr.id,
      'reject',
      { comment: 'Please attach proof', version: pcr.version },
      hr.cookie,
    );
    expect(res.status).toBe(200);
    expect((await json<Pcr>(res)).status).toBe('rejected');
    const [emp] = await f.db
      .select()
      .from(schema.employees)
      .where(eq(schema.employees.id, me.employeeId as string));
    expect(emp?.lastName).not.toBe('Changed');
  });

  it('forbids HR from deciding their own request (SELF_APPROVAL_FORBIDDEN)', async () => {
    const pcr = await json<Pcr>(await request(hrEmployee, { preferredName: 'Self' }));
    const res = await act(pcr.id, 'approve', { version: pcr.version }, hrEmployee.cookie);
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('SELF_APPROVAL_FORBIDDEN');
  });

  it('returns 404 to a non-reviewer and for another company', async () => {
    const me = await f.signIn({ employee: true, strong: false });
    const pcr = await json<Pcr>(await request(me, { preferredName: 'Nope' }));
    expect((await act(pcr.id, 'approve', { version: pcr.version }, me.cookie)).status).toBe(404);
    const other = await setupCompany('Other Profile Co');
    const otherHr = await other.signIn({ roles: ['hr_admin'] });
    expect((await act(pcr.id, 'approve', { version: pcr.version }, otherHr.cookie)).status).toBe(404);
  });
});

describe('withdraw and list', () => {
  it('lets the requester withdraw a pending request, and nobody else', async () => {
    const me = await f.signIn({ employee: true, strong: false });
    const someoneElse = await f.signIn({ employee: true, strong: false });
    const pcr = await json<Pcr>(await request(me, { preferredName: 'Gone' }));
    expect((await act(pcr.id, 'withdraw', { version: pcr.version }, someoneElse.cookie)).status).toBe(404);
    const res = await act(pcr.id, 'withdraw', { version: pcr.version }, me.cookie);
    expect(res.status).toBe(200);
    expect((await json<Pcr>(res)).status).toBe('withdrawn');
    const [approval] = await f.db
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.profileChangeRequestId, pcr.id));
    expect(approval?.state).toBe('withdrawn');
    expect((await act(pcr.id, 'withdraw', { version: pcr.version + 1 }, me.cookie)).status).toBe(409);
    expect((await auditFor(f.db, pcr.id)).map((a) => a.action)).toContain('profile_change.withdrawn');
  });

  it('lists all requests for HR and only their own for an employee', async () => {
    const me = await f.signIn({ employee: true, strong: false });
    await request(me, { preferredName: 'Listed' });
    const mine = await json<{ data: Pcr[]; page: { totalItems: number } }>(
      await call('GET', '/api/v1/profile-change-requests', { cookie: me.cookie }),
    );
    expect(mine.data.map((r) => r.employee.id)).toEqual([me.employeeId]);
    const all = await json<{ data: Pcr[]; page: { totalItems: number } }>(
      await call('GET', '/api/v1/profile-change-requests?status=pending&pageSize=100', { cookie: hr.cookie }),
    );
    expect(all.data.length).toBeGreaterThan(1);
    expect(all.data.every((r) => r.status === 'pending')).toBe(true);
    const nobody = await f.signIn({ strong: false });
    expect((await call('GET', '/api/v1/profile-change-requests', { cookie: nobody.cookie })).status).toBe(
      403,
    );
    expect(
      (await call('GET', '/api/v1/profile-change-requests?status=done', { cookie: hr.cookie })).status,
    ).toBe(400);
  });
});
