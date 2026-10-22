import { schema } from '@hrm/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditFor, call, json, outboxFor, type TestUser } from '../harness';
import {
  claim,
  get,
  HOOK_TIMEOUT,
  type Item,
  itemOf,
  key,
  m,
  ok,
  post,
  type Run,
  runTo,
  type Scenario,
  scenario,
  structure,
} from './payroll-helpers';

// PAY-11 (partial and failed payments), payments import, mark-paid, reconcile, publish and payslips.
let s: Scenario;
let a: TestUser; // E-A, linked user
let b: TestUser; // E-B, linked user
let cId: string; // E-C
let run: Run;
let items: { a: Item; b: Item; c: Item };
let rc: string;

type Payment = { id: string; status: string; amount: { amount: string }; chequeNumber: string | null };
type Rec = {
  balanced: boolean;
  totals: Record<'gross' | 'deductions' | 'net' | 'paid' | 'outstanding', { amount: string }>;
  items: {
    payrollItemId: string;
    paid: { amount: string };
    outstanding: { amount: string };
    exceptions: string[];
  }[];
};

const pay = (body: Record<string, unknown>, user: TestUser = s.po) =>
  post(user, `/payroll/runs/${run.id}/payments`, body);
const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

beforeAll(async () => {
  s = await scenario('Payroll payments Co');
  a = await s.f.signIn({ employee: true, strong: false, name: 'Asha A' });
  b = await s.f.signIn({ employee: true, strong: false, name: 'Babu B' });
  cId = await s.f.employee({});
  await structure(s.f, a.employeeId as string, '52000.00');
  await structure(s.f, b.employeeId as string, '22500.00');
  await structure(s.f, cId, '24838.71');
  rc = await claim(s.f, a.employeeId as string, '650.00', '2027-03-05');
  run = await runTo(s, 2027, 3, 'locked');
  items = {
    a: await itemOf(s, run.id, a.employeeId as string),
    b: await itemOf(s, run.id, b.employeeId as string),
    c: await itemOf(s, run.id, cId),
  };
}, HOOK_TIMEOUT);

describe('PAY-11 payments and reconciliation', () => {
  it('locks with the claim included; net total 99,988.71 (claim 650.00 on E-A)', async () => {
    expect(run.totals?.net.amount).toBe('99988.71');
    expect(items.a.netAmount).toEqual(m('52650.00'));
    const [row] = await s.f.db
      .select()
      .from(schema.reimbursementClaims)
      .where(eq(schema.reimbursementClaims.id, rc));
    expect(row).toMatchObject({ status: 'included', payrollItemId: items.a.id });
    // the employee sees which run includes the claim (US-REIM-003)
    const mine = await ok<{ payrollRunNumber: string; status: string }>(
      get(a, `/reimbursement-claims/${rc}`),
    );
    expect(mine).toMatchObject({ status: 'included', payrollRunNumber: run.runNumber });
  });

  it('validates payment input', async () => {
    expect(
      (
        await pay({
          payrollItemId: items.b.id,
          method: 'cheque',
          amount: m('22500.00'),
          paidOn: '2027-04-02',
        })
      ).status,
    ).toBe(400);
    expect(
      (await pay({ payrollItemId: items.a.id, method: 'cash', amount: m('52650.00'), paidOn: '2027-04-02' }))
        .status,
    ).toBe(400);
    expect(
      (await pay({ payrollItemId: items.a.id, method: 'card', amount: m('1.00'), paidOn: '2027-04-02' }))
        .status,
    ).toBe(400);
    expect(
      (
        await post(
          s.po,
          `/payroll/runs/${run.id}/payments`,
          {
            payrollItemId: items.a.id,
            method: 'cash',
            amount: m('52650.00'),
            paidOn: '2027-04-02',
            reference: 'ACK',
          },
          {},
        )
      ).status,
    ).toBe(400);
  });

  it('checks permissions and fresh authentication', async () => {
    const body = {
      payrollItemId: items.a.id,
      method: 'cash',
      amount: m('52650.00'),
      paidOn: '2027-04-02',
      reference: 'ACK-0311',
    };
    expect((await pay(body, s.director)).status).toBe(403);
    expect((await pay(body, a)).status).toBe(403);
    const stale = await call('POST', `/api/v1/payroll/runs/${run.id}/payments`, {
      cookie: s.po.cookie,
      body,
      headers: key(),
      now: later(20),
    });
    expect(stale.status).toBe(403);
    expect((await json(stale)).code).toBe('REAUTH_REQUIRED');
  });

  it('records cash and cheque payments; rejects a different amount, a second payment and a reused cheque number', async () => {
    const pa = await ok<Payment>(
      pay({
        payrollItemId: items.a.id,
        method: 'cash',
        amount: m('52650.00'),
        paidOn: '2027-04-02',
        reference: 'ACK-0311',
        acknowledgedByName: 'Asha A',
      }),
      201,
    );
    expect(pa).toMatchObject({ status: 'paid', amount: m('52650.00') });
    expect((await auditFor(s.f.db, pa.id)).map((x) => [x.action, x.category])).toEqual([
      ['payroll_payment.recorded', 'payroll'],
    ]);
    await ok(
      pay({
        payrollItemId: items.b.id,
        method: 'cheque',
        amount: m('22500.00'),
        paidOn: '2027-04-02',
        chequeNumber: '004512',
      }),
      201,
    );

    const mismatch = await pay({
      payrollItemId: items.c.id,
      method: 'cheque',
      amount: m('24838.00'),
      paidOn: '2027-04-02',
      chequeNumber: '004513',
    });
    expect(mismatch.status).toBe(409);
    expect((await json(mismatch)).code).toBe('PAYMENT_AMOUNT_MISMATCH');
    const second = await pay({
      payrollItemId: items.a.id,
      method: 'cash',
      amount: m('52650.00'),
      paidOn: '2027-04-03',
      reference: 'ACK-9',
    });
    expect(second.status).toBe(409);
    expect((await json(second)).code).toBe('PAYMENT_AMOUNT_MISMATCH');
    const dupCheque = await pay({
      payrollItemId: items.c.id,
      method: 'cheque',
      amount: m('24838.71'),
      paidOn: '2027-04-02',
      chequeNumber: '004512',
    });
    expect(dupCheque.status).toBe(409);
    expect((await json(dupCheque)).code).toBe('DUPLICATE');
    const unknownItem = await pay({
      payrollItemId: run.id,
      method: 'cash',
      amount: m('1.00'),
      paidOn: '2027-04-02',
      reference: 'R',
    });
    expect(unknownItem.status).toBe(400);
  });

  it('a bounced cheque is recorded as failed; reconciliation shows the outstanding amount and the exception', async () => {
    const pc = await ok<Payment>(
      pay({
        payrollItemId: items.c.id,
        method: 'cheque',
        amount: m('24838.71'),
        paidOn: '2027-04-02',
        chequeNumber: '004513',
      }),
      201,
    );
    expect((await post(s.po, `/payroll/payments/${pc.id}/cancel`, { outcome: 'failed' })).status).toBe(400);
    const failed = await ok<Payment>(
      post(s.po, `/payroll/payments/${pc.id}/cancel`, { reason: 'Cheque bounced', outcome: 'failed' }),
    );
    expect(failed.status).toBe('failed');
    expect((await post(s.po, `/payroll/payments/${pc.id}/cancel`, { reason: 'again' })).status).toBe(409);
    expect((await post(s.po, `/payroll/payments/${run.id}/cancel`, { reason: 'none' })).status).toBe(404);
    expect((await auditFor(s.f.db, pc.id)).map((x) => x.action)).toEqual([
      'payroll_payment.recorded',
      'payroll_payment.cancelled',
    ]);

    const rec = await ok<Rec>(get(s.director, `/payroll/runs/${run.id}/reconciliation`));
    expect(rec.totals).toMatchObject({ net: m('99988.71'), paid: m('75150.00'), outstanding: m('24838.71') });
    expect(rec.balanced).toBe(false);
    expect(rec.items.find((i) => i.payrollItemId === items.c.id)?.exceptions).toEqual([
      'payment_failed',
      'unpaid',
    ]);

    const markPaid = await post(s.po, `/payroll/runs/${run.id}/mark-paid`, { version: run.version });
    expect(markPaid.status).toBe(409);
    expect((await json(markPaid)).code).toBe('PAYMENT_AMOUNT_MISMATCH');
    const reconcile = await post(s.po, `/payroll/runs/${run.id}/reconcile`, { version: run.version });
    expect(reconcile.status).toBe(409);
    expect((await ok<Run>(get(s.po, `/payroll/runs/${run.id}`))).status).toBe('locked');
  });

  it('a new cash payment settles E-C; the run moves to paid (claims paid), then reconciled', async () => {
    await ok(
      pay({
        payrollItemId: items.c.id,
        method: 'cash',
        amount: m('24838.71'),
        paidOn: '2027-04-05',
        reference: 'ACK-0402',
      }),
      201,
    );
    const rows = await s.f.db
      .select()
      .from(schema.payrollPayments)
      .where(eq(schema.payrollPayments.payrollItemId, items.c.id));
    expect(rows.map((r) => r.status).sort()).toEqual(['failed', 'paid']);
    const rec = await ok<Rec>(get(s.po, `/payroll/runs/${run.id}/reconciliation`));
    expect(rec.totals).toMatchObject({ paid: m('99988.71'), outstanding: m('0.00') });
    expect(rec.balanced).toBe(true);

    const current = await ok<Run>(get(s.po, `/payroll/runs/${run.id}`));
    expect(
      (await post(s.po, `/payroll/runs/${run.id}/mark-paid`, { version: current.version - 1 })).status,
    ).toBe(409);
    const paid = await ok<Run>(post(s.po, `/payroll/runs/${run.id}/mark-paid`, { version: current.version }));
    expect(paid.status).toBe('paid');
    const [c] = await s.f.db
      .select()
      .from(schema.reimbursementClaims)
      .where(eq(schema.reimbursementClaims.id, rc));
    expect(c?.status).toBe('paid');
    const lateCancel = await post(
      s.po,
      `/payroll/payments/${rows.find((r) => r.status === 'paid')?.id}/cancel`,
      { reason: 'Too late' },
    );
    expect(lateCancel.status).toBe(409);
    const reconciled = await ok<Run>(
      post(s.po, `/payroll/runs/${run.id}/reconcile`, { version: paid.version }),
    );
    expect(reconciled.status).toBe('reconciled');
    expect((await auditFor(s.f.db, run.id)).map((x) => x.action).slice(-2)).toEqual([
      'payroll_run.paid',
      'payroll_run.reconciled',
    ]);
  });
});

describe('payments import (CSV)', () => {
  let apr: Run;
  let codes: Record<'a' | 'b' | 'c', string>;
  beforeAll(async () => {
    apr = await runTo(s, 2027, 4, 'locked');
    const code = async (id: string) =>
      (await s.f.db.select().from(schema.employees).where(eq(schema.employees.id, id)))[0]
        ?.employeeCode as string;
    codes = {
      a: await code(a.employeeId as string),
      b: await code(b.employeeId as string),
      c: await code(cId),
    };
  }, HOOK_TIMEOUT);
  const header = 'employeeCode,method,amount,paidOn,chequeNumber,reference';

  it('previews every row error on a dry run and records nothing on a bad file', async () => {
    const csv = [
      header,
      `${codes.a},cash,52000.00,2027-05-02,,ACK-1`,
      `${codes.b},cheque,22500.00,2027-05-02,004512,`,
      'NOPE-1,cash,1.00,2027-05-02,,ACK-2',
      `${codes.c},cheque,1.00,2027-05-02,,`,
    ].join('\n');
    const preview = await ok<{
      applied: boolean;
      invalidRows: number;
      rows: { line: number; errors: { code: string }[] }[];
    }>(post(s.po, `/payroll/runs/${apr.id}/payments/import?dryRun=true`, { csv }));
    expect(preview.applied).toBe(false);
    expect(preview.rows.map((r) => r.errors.map((e) => e.code))).toEqual([
      [],
      ['duplicate_cheque'],
      ['not_in_run'],
      ['cheque_number_required'],
    ]);
    const real = await post(s.po, `/payroll/runs/${apr.id}/payments/import`, { csv });
    expect(real.status).toBe(400);
    const rows = await s.f.db
      .select()
      .from(schema.payrollPayments)
      .where(eq(schema.payrollPayments.payrollItemId, (await itemOf(s, apr.id, a.employeeId as string)).id));
    expect(rows).toEqual([]);
    expect(
      (await post(s.po, `/payroll/runs/${apr.id}/payments/import`, { csv: 'who,what\n1,2' })).status,
    ).toBe(400);
  });

  it('applies a valid file in one transaction and replays a retry', async () => {
    const csv = [
      header,
      `${codes.a},cash,52000.00,2027-05-02,,ACK-1`,
      `${codes.b},cheque,22500.00,2027-05-02,104512,`,
      `${codes.c},cheque,24838.71,2027-05-02,104513,`,
    ].join('\r\n');
    const dry = await ok<{ applied: boolean; validRows: number }>(
      post(s.po, `/payroll/runs/${apr.id}/payments/import?dryRun=true`, { csv }),
    );
    expect(dry).toMatchObject({ applied: false, validRows: 3 });
    const k = key();
    const done = await ok<{ applied: boolean }>(
      post(s.po, `/payroll/runs/${apr.id}/payments/import`, { csv }, k),
    );
    expect(done.applied).toBe(true);
    const replay = await post(s.po, `/payroll/runs/${apr.id}/payments/import`, { csv }, k);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    const rec = await ok<Rec>(get(s.po, `/payroll/runs/${apr.id}/reconciliation`));
    expect(rec).toMatchObject({ balanced: true, totals: { outstanding: m('0.00'), paid: m('99338.71') } });
  });
});

describe('concurrent payments (FR-PAY-019)', () => {
  it('two parallel payments for one item with different keys: one is recorded, the other is refused', async () => {
    const jul = await runTo(s, 2027, 7, 'locked');
    const it = await itemOf(s, jul.id, b.employeeId as string);
    const body = (ref: string) => ({
      payrollItemId: it.id,
      method: 'cash',
      amount: m('22500.00'),
      paidOn: '2027-08-01',
      reference: ref,
    });
    const [r1, r2] = await Promise.all([
      post(s.po, `/payroll/runs/${jul.id}/payments`, body('ACK-A')),
      post(s.po, `/payroll/runs/${jul.id}/payments`, body('ACK-B')),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const rows = await s.f.db
      .select()
      .from(schema.payrollPayments)
      .where(eq(schema.payrollPayments.payrollItemId, it.id));
    expect(rows).toHaveLength(1);
  });
});

describe('publish payslips and read them (US-PAY-009)', () => {
  type Slip = {
    id: string;
    employee: { id: string };
    netAmount: { amount: string };
    firstViewedAt: string | null;
  };

  it('refuses before lock and without payroll.pay', async () => {
    const draft = await runTo(s, 2027, 6, 'approved');
    expect((await post(s.po, `/payroll/runs/${draft.id}/publish-payslips`)).status).toBe(409);
    expect((await post(s.director, `/payroll/runs/${run.id}/publish-payslips`)).status).toBe(403);
  });

  it('creates one payslip per item and emails employees without amounts; a second publish is refused', async () => {
    const res = await ok<{ published: number }>(post(s.po, `/payroll/runs/${run.id}/publish-payslips`));
    expect(res.published).toBe(3);
    const mails = (await outboxFor(s.f.db, s.f.companyId, ['email.payslip_published'])).map(
      (x) => x.payload as Record<string, string>,
    );
    expect(mails.map((x) => x.recipientUserId).sort()).toEqual([a.userId, b.userId].sort());
    expect(mails[0]?.periodLabel).toBe('March 2027');
    expect(JSON.stringify(mails)).not.toMatch(/52650|22500|24838/);
    expect((await auditFor(s.f.db, run.id)).at(-1)).toMatchObject({
      action: 'payslips.published',
      category: 'payroll',
    });
    expect((await post(s.po, `/payroll/runs/${run.id}/publish-payslips`)).status).toBe(409);
  });

  it('employees list and read only their own payslips; the first own view is recorded once', async () => {
    const mine = await ok<{ data: Slip[] }>(get(a, '/payroll/payslips/me'));
    expect(mine.data).toHaveLength(1);
    expect(mine.data[0]).toMatchObject({
      employee: { id: a.employeeId },
      netAmount: m('52650.00'),
      firstViewedAt: null,
    });
    const id = mine.data[0]?.id as string;

    const data = await ok<{
      lines: { code: string; amount: { amount: string } }[];
      totals: { net: { amount: string } };
      firstViewedAt: string | null;
      runNumber: string;
      period: { year: number; month: number; daysInPeriod: number };
      paymentStatus: string;
    }>(get(a, `/payroll/payslips/${id}`));
    expect(data.lines.map((l) => [l.code, l.amount.amount])).toEqual([
      ['base_salary', '52000.00'],
      ['reimbursement', '650.00'],
    ]);
    expect(data).toMatchObject({
      totals: { net: m('52650.00') },
      runNumber: run.runNumber,
      period: { year: 2027, month: 3, daysInPeriod: 31 },
      paymentStatus: 'paid',
    });
    expect(data.firstViewedAt).not.toBeNull();
    await ok(get(a, `/payroll/payslips/${id}`));
    const views = (await auditFor(s.f.db, id)).filter((x) => x.action === 'payslip.viewed');
    expect(views).toHaveLength(1);
    expect(views[0]?.metadata).toMatchObject({ byOwner: true, firstView: true });

    expect((await get(b, `/payroll/payslips/${id}`)).status).toBe(404);
    expect((await get(b, '/payroll/payslips')).status).toBe(403);
    await ok(get(s.director, `/payroll/payslips/${id}`));
    const after = (await auditFor(s.f.db, id)).filter((x) => x.action === 'payslip.viewed');
    expect(after).toHaveLength(2);
    expect(after[1]?.metadata).toMatchObject({ byOwner: false });
  });

  it('lists all payslips for payslip.read.all with filters', async () => {
    const all = await ok<{ data: Slip[] }>(get(s.po, `/payroll/payslips?employeeId=${b.employeeId}`));
    expect(all.data.map((x) => x.employee.id)).toEqual([b.employeeId]);
    expect((await ok<{ data: Slip[] }>(get(s.po, '/payroll/payslips?year=2026'))).data).toEqual([]);
  });
});
