import { schema, uuidv7 } from '@hrm/db';
import { addDays, toBusinessDate } from '@hrm/domain';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  auditFor,
  call,
  eventually,
  type Fixture,
  json,
  outboxFor,
  setupCompany,
  type TestUser,
} from '../harness';

type Claim = {
  id: string;
  claimNumber: string;
  status: string;
  version: number;
  amount: { amount: string; currency: string };
  employee: { id: string };
  decisionComment: string | null;
  payrollRunNumber: string | null;
};

let f: Fixture;
let hr: TestUser;
let manager: TestUser;
let employee: TestUser;
let peer: TestUser;
let otherManager: TestUser;
let plain: TestUser;
let other: Fixture;

const today = () => toBusinessDate(new Date());
const body = (over: Record<string, unknown> = {}) => ({
  expenseDate: addDays(today(), -3),
  amount: { amount: '350.00', currency: 'BDT' },
  description: 'Rickshaw to client office',
  ...over,
});

async function create(user: TestUser, over: Record<string, unknown> = {}) {
  const res = await call('POST', '/api/v1/reimbursement-claims', { cookie: user.cookie, body: body(over) });
  expect(res.status).toBe(201);
  return json<Claim>(res);
}

async function submitted(user: TestUser, over: Record<string, unknown> = {}) {
  const c = await create(user, over);
  const res = await call('POST', `/api/v1/reimbursement-claims/${c.id}/submit`, {
    cookie: user.cookie,
    body: { version: c.version },
  });
  expect(res.status).toBe(200);
  return json<Claim>(res);
}

beforeAll(async () => {
  f = await setupCompany('Claims Co');
  hr = await f.signIn({ roles: ['hr_admin'], employee: true });
  manager = await f.signIn({ employee: true, name: 'Mina Manager' });
  employee = await f.signIn({
    employee: { managerId: manager.employeeId },
    strong: false,
    name: 'Eli Employee',
  });
  peer = await f.signIn({ employee: { managerId: manager.employeeId }, strong: false });
  otherManager = await f.signIn({ employee: true });
  await f.employee({ managerId: otherManager.employeeId });
  plain = await f.signIn({ strong: false });
  other = await setupCompany('Other Claims Co');
}, 120_000);

describe('POST /reimbursement-claims (FR-REIM-001)', () => {
  it('creates a draft with an RC- number for the signed-in employee', async () => {
    const res = await call('POST', '/api/v1/reimbursement-claims', {
      cookie: employee.cookie,
      body: { ...body(), employeeId: peer.employeeId },
    });
    // unknown properties are rejected: the employee always comes from the session
    expect(res.status).toBe(400);
    const c = await create(employee);
    expect(c).toMatchObject({
      status: 'draft',
      amount: { amount: '350.00', currency: 'BDT' },
      payrollRunNumber: null,
    });
    expect(c.claimNumber).toMatch(/^RC-\d{6}$/);
    expect(c.employee.id).toBe(employee.employeeId);
  });

  it('returns 400 for a zero amount and a short description', async () => {
    const res = await call('POST', '/api/v1/reimbursement-claims', {
      cookie: employee.cookie,
      body: body({ amount: { amount: '0.00', currency: 'BDT' }, description: 'x' }),
    });
    expect(res.status).toBe(400);
    const paths = (await json<{ errors: { path: string }[] }>(res)).errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['/amount/amount', '/description']));
  });

  it('returns 400 for a number amount (money is a string)', async () => {
    const res = await call('POST', '/api/v1/reimbursement-claims', {
      cookie: employee.cookie,
      body: body({ amount: { amount: 350, currency: 'BDT' } }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 403 to a user without a linked employee', async () => {
    const res = await call('POST', '/api/v1/reimbursement-claims', { cookie: plain.cookie, body: body() });
    expect(res.status).toBe(403);
  });

  it("rejects another employee's receipt document", async () => {
    const docId = uuidv7();
    await f.db.insert(schema.documents).values({
      id: docId,
      companyId: f.companyId,
      employeeId: peer.employeeId,
      category: 'receipt',
      title: 'Peer receipt',
    });
    const res = await call('POST', '/api/v1/reimbursement-claims', {
      cookie: employee.cookie,
      body: body({ receiptDocumentId: docId }),
    });
    expect(res.status).toBe(400);
    expect((await json<{ errors: { path: string }[] }>(res)).errors[0]?.path).toBe('/receiptDocumentId');
  });

  it('accepts the employee’s own receipt', async () => {
    const docId = uuidv7();
    await f.db.insert(schema.documents).values({
      id: docId,
      companyId: f.companyId,
      employeeId: employee.employeeId,
      category: 'receipt',
      title: 'My receipt',
    });
    const c = await create(employee, { receiptDocumentId: docId });
    expect(c).toMatchObject({ status: 'draft' });
  });
});

describe('draft edits (FR-REIM-004)', () => {
  it('updates and deletes a draft; stale versions conflict', async () => {
    const c = await create(employee);
    const res = await call('PATCH', `/api/v1/reimbursement-claims/${c.id}`, {
      cookie: employee.cookie,
      body: { amount: { amount: '400.50', currency: 'BDT' }, version: c.version },
    });
    expect(res.status).toBe(200);
    expect((await json<Claim>(res)).amount.amount).toBe('400.50');
    const stale = await call('PATCH', `/api/v1/reimbursement-claims/${c.id}`, {
      cookie: employee.cookie,
      body: { description: 'Changed again', version: c.version },
    });
    expect(stale.status).toBe(409);
    expect((await json(stale)).code).toBe('VERSION_CONFLICT');
    const del = await call('DELETE', `/api/v1/reimbursement-claims/${c.id}`, { cookie: employee.cookie });
    expect(del.status).toBe(204);
    expect(
      (await call('GET', `/api/v1/reimbursement-claims/${c.id}`, { cookie: employee.cookie })).status,
    ).toBe(404);
  });

  it('refuses to edit or delete a submitted claim with 409 INVALID_TRANSITION', async () => {
    const c = await submitted(employee);
    const patch = await call('PATCH', `/api/v1/reimbursement-claims/${c.id}`, {
      cookie: employee.cookie,
      body: { description: 'Sneaky edit', version: c.version },
    });
    expect(patch.status).toBe(409);
    expect((await json(patch)).code).toBe('INVALID_TRANSITION');
    const del = await call('DELETE', `/api/v1/reimbursement-claims/${c.id}`, { cookie: employee.cookie });
    expect(del.status).toBe(409);
  });

  it("returns 404 for another employee's draft (IDOR)", async () => {
    const c = await create(peer);
    const res = await call('PATCH', `/api/v1/reimbursement-claims/${c.id}`, {
      cookie: employee.cookie,
      body: { description: 'Not mine', version: c.version },
    });
    expect(res.status).toBe(404);
    const del = await call('DELETE', `/api/v1/reimbursement-claims/${c.id}`, { cookie: employee.cookie });
    expect(del.status).toBe(404);
    const sub = await call('POST', `/api/v1/reimbursement-claims/${c.id}/submit`, {
      cookie: employee.cookie,
      body: { version: c.version },
    });
    expect(sub.status).toBe(404);
  });
});

describe('POST /reimbursement-claims/{id}/submit', () => {
  it('moves draft → submitted, routes to the manager, audits and emails them', async () => {
    const c = await submitted(employee);
    expect(c.status).toBe('submitted');
    expect((await auditFor(f.db, c.id)).map((a) => a.action)).toEqual(['reimbursement_claim.submitted']);
    const [req] = await f.db
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.reimbursementClaimId, c.id));
    const [step] = await f.db
      .select()
      .from(schema.approvalSteps)
      .where(eq(schema.approvalSteps.approvalRequestId, req?.id as string));
    expect(step?.approverUserId).toBe(manager.userId);
    const mails = await outboxFor(f.db, f.companyId, ['email.approval_requested']);
    expect(mails.some((m) => m.dedupeKey === `reimbursement_claim.submitted:${c.id}:${manager.userId}`)).toBe(
      true,
    );
  });

  it('routes a claim of an employee without a manager to reimbursement.review.all', async () => {
    const c = await submitted(otherManager);
    const [req] = await f.db
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.reimbursementClaimId, c.id));
    const [step] = await f.db
      .select()
      .from(schema.approvalSteps)
      .where(eq(schema.approvalSteps.approvalRequestId, req?.id as string));
    expect(step?.approverPermission).toBe('reimbursement.review.all');
  });

  it('rejects an expense older than reimbursements.max_claim_age_days with 422 INVALID_DATE', async () => {
    const c = await create(employee, { expenseDate: addDays(today(), -61) });
    const res = await call('POST', `/api/v1/reimbursement-claims/${c.id}/submit`, {
      cookie: employee.cookie,
      body: { version: c.version },
    });
    expect(res.status).toBe(422);
    expect((await json(res)).code).toBe('INVALID_DATE');
  });

  it('rejects a future expense date', async () => {
    const c = await create(employee, { expenseDate: addDays(today(), 2) });
    const res = await call('POST', `/api/v1/reimbursement-claims/${c.id}/submit`, {
      cookie: employee.cookie,
      body: { version: c.version },
    });
    expect(res.status).toBe(422);
  });

  it('returns 409 INVALID_TRANSITION when submitting twice', async () => {
    const c = await submitted(employee);
    const res = await call('POST', `/api/v1/reimbursement-claims/${c.id}/submit`, {
      cookie: employee.cookie,
      body: { version: c.version },
    });
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe('INVALID_TRANSITION');
  });
});

describe('POST /reimbursement-claims/{id}/withdraw', () => {
  it('moves submitted → withdrawn and closes the approval', async () => {
    const c = await submitted(employee);
    const res = await call('POST', `/api/v1/reimbursement-claims/${c.id}/withdraw`, {
      cookie: employee.cookie,
      body: { version: c.version },
    });
    expect(res.status).toBe(200);
    expect((await json<Claim>(res)).status).toBe('withdrawn');
    const [req] = await f.db
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.reimbursementClaimId, c.id));
    expect(req?.state).toBe('withdrawn');
    const again = await call('POST', `/api/v1/reimbursement-claims/${c.id}/withdraw`, {
      cookie: employee.cookie,
      body: { version: c.version + 1 },
    });
    expect(again.status).toBe(409);
    // a withdrawn claim cannot be approved
    const approve = await call('POST', `/api/v1/reimbursement-claims/${c.id}/approve`, {
      cookie: manager.cookie,
      body: { version: c.version + 1 },
    });
    expect(approve.status).toBe(409);
  });

  it('cannot withdraw a draft', async () => {
    const c = await create(employee);
    const res = await call('POST', `/api/v1/reimbursement-claims/${c.id}/withdraw`, {
      cookie: employee.cookie,
      body: { version: c.version },
    });
    expect(res.status).toBe(409);
  });
});

describe('approve and reject (FR-REIM-002)', () => {
  it('lets the direct manager approve, audits it and emails the requester', async () => {
    const c = await submitted(employee);
    const res = await call('POST', `/api/v1/reimbursement-claims/${c.id}/approve`, {
      cookie: manager.cookie,
      body: { comment: 'OK', version: c.version },
    });
    expect(res.status).toBe(200);
    expect((await json<Claim>(res)).status).toBe('approved');
    expect((await auditFor(f.db, c.id)).map((a) => a.action)).toEqual([
      'reimbursement_claim.submitted',
      'reimbursement_claim.approved',
    ]);
    const [mail] = (await outboxFor(f.db, f.companyId, ['email.request_decided'])).filter(
      (m) => m.dedupeKey === `reimbursement_claim.approved:${c.id}`,
    );
    expect(mail?.payload).toMatchObject({ recipientUserId: employee.userId, decision: 'approved' });
    await eventually(async () => {
      const [m] = await f.db
        .select()
        .from(schema.outboxMessages)
        .where(eq(schema.outboxMessages.id, mail?.id as string));
      return m?.status === 'sent';
    });
    const again = await call('POST', `/api/v1/reimbursement-claims/${c.id}/approve`, {
      cookie: manager.cookie,
      body: { version: c.version + 1 },
    });
    expect(again.status).toBe(409);
    expect((await json(again)).code).toBe('INVALID_TRANSITION');
  });

  it('returns 404 to a manager outside the reporting line (IDOR)', async () => {
    const c = await submitted(employee);
    const res = await call('POST', `/api/v1/reimbursement-claims/${c.id}/approve`, {
      cookie: otherManager.cookie,
      body: { version: c.version },
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 to an employee without review permission', async () => {
    const c = await submitted(employee);
    const res = await call('POST', `/api/v1/reimbursement-claims/${c.id}/approve`, {
      cookie: peer.cookie,
      body: { version: c.version },
    });
    expect(res.status).toBe(404);
  });

  it('lets HR decide on behalf of the manager (D-014) and records it', async () => {
    const c = await submitted(employee);
    const res = await call('POST', `/api/v1/reimbursement-claims/${c.id}/approve`, {
      cookie: hr.cookie,
      body: { version: c.version },
    });
    expect(res.status).toBe(200);
    const audit = (await auditFor(f.db, c.id)).at(-1);
    expect(audit?.metadata).toMatchObject({ onBehalf: true, to: 'approved' });
  });

  it('forbids deciding one’s own claim (FR-WF-004)', async () => {
    const own = await submitted(hr);
    const res = await call('POST', `/api/v1/reimbursement-claims/${own.id}/approve`, {
      cookie: hr.cookie,
      body: { version: own.version },
    });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('SELF_APPROVAL_FORBIDDEN');
    // a manager's own claim is not in their team scope at all
    const mine = await submitted(manager);
    const res2 = await call('POST', `/api/v1/reimbursement-claims/${mine.id}/approve`, {
      cookie: manager.cookie,
      body: { version: mine.version },
    });
    expect(res2.status).toBe(404);
  });

  it('requires a comment to reject, then rejects', async () => {
    const c = await submitted(employee);
    const bad = await call('POST', `/api/v1/reimbursement-claims/${c.id}/reject`, {
      cookie: manager.cookie,
      body: { version: c.version },
    });
    expect(bad.status).toBe(400);
    const res = await call('POST', `/api/v1/reimbursement-claims/${c.id}/reject`, {
      cookie: manager.cookie,
      body: { comment: 'No receipt for a long trip', version: c.version },
    });
    expect(res.status).toBe(200);
    expect(await json<Claim>(res)).toMatchObject({
      status: 'rejected',
      decisionComment: 'No receipt for a long trip',
    });
  });

  it('returns 409 VERSION_CONFLICT for a stale version and leaves the claim submitted', async () => {
    const c = await submitted(employee);
    const res = await call('POST', `/api/v1/reimbursement-claims/${c.id}/approve`, {
      cookie: manager.cookie,
      body: { version: c.version - 1 },
    });
    expect(res.status).toBe(409);
    const [row] = await f.db
      .select()
      .from(schema.reimbursementClaims)
      .where(eq(schema.reimbursementClaims.id, c.id));
    expect(row?.status).toBe('submitted');
  });
});

describe('GET /reimbursement-claims', () => {
  it('scopes the list: own, team + own, all', async () => {
    const mine = await create(employee);
    const peers = await create(peer);
    const outside = await create(otherManager);
    const ids = async (u: TestUser, q = '') =>
      (
        await json<{ data: Claim[] }>(
          await call('GET', `/api/v1/reimbursement-claims?pageSize=100${q}`, { cookie: u.cookie }),
        )
      ).data.map((c) => c.id);

    const e = await ids(employee);
    expect(e).toContain(mine.id);
    expect(e).not.toContain(peers.id);
    const m = await ids(manager);
    expect(m).toEqual(expect.arrayContaining([mine.id, peers.id]));
    expect(m).not.toContain(outside.id);
    const h = await ids(hr);
    expect(h).toEqual(expect.arrayContaining([mine.id, peers.id, outside.id]));
    // filters never widen access
    expect(await ids(employee, `&employeeId=${peer.employeeId}`)).toEqual([]);
    expect(await ids(hr, '&status=draft')).toContain(mine.id);
  });

  it('returns 403 to a user with no claim permission and 400 for unknown filters', async () => {
    expect((await call('GET', '/api/v1/reimbursement-claims', { cookie: plain.cookie })).status).toBe(403);
    expect((await call('GET', '/api/v1/reimbursement-claims?foo=1', { cookie: hr.cookie })).status).toBe(400);
  });

  it("never shows another company's claims (404 by id)", async () => {
    const otherEmp = await other.signIn({ employee: true, strong: false });
    const theirs = await create(otherEmp);
    expect(
      (await call('GET', `/api/v1/reimbursement-claims/${theirs.id}`, { cookie: hr.cookie })).status,
    ).toBe(404);
    const [row] = await f.db
      .select()
      .from(schema.reimbursementClaims)
      .where(
        and(
          eq(schema.reimbursementClaims.id, theirs.id),
          eq(schema.reimbursementClaims.companyId, f.companyId),
        ),
      );
    expect(row).toBeUndefined();
  });
});
