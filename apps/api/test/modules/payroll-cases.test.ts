import { schema } from '@hrm/db';
import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditFor, json } from '../harness';
import {
  approve,
  calculate,
  claim,
  createRun,
  employee,
  get,
  HOOK_TIMEOUT,
  itemDetail,
  itemOf,
  items,
  lock,
  m,
  net,
  ok,
  period,
  post,
  type Run,
  runTo,
  scenario,
  setSetting,
  structure,
  submit,
} from './payroll-helpers';

// Every case of docs/07-quality/PAYROLL-TEST-CASES.md, end to end through the API. Each case uses its own company so
// the eligible-employee set is exactly the case's employees.
const T = { timeout: HOOK_TIMEOUT };

describe('PAYROLL-TEST-CASES', () => {
  it('PAY-01 normal full month: one base line, net 52,000.00', T, async () => {
    const s = await scenario('PAY-01');
    const a = await employee(s.f);
    await structure(s.f, a.id, '52000.00');
    const run = await runTo(s, 2026, 11, 'calculated');
    const it = await itemOf(s, run.id, a.id);
    expect(it).toMatchObject({
      grossAmount: m('52000.00'),
      deductionAmount: m('0.00'),
      netAmount: m('52000.00'),
      daysEmployed: 30,
      validationFlags: [],
    });
    expect((await itemDetail(s, run.id, it.id)).lines.map((l) => [l.code, l.amount.amount])).toEqual([
      ['base_salary', '52000.00'],
    ]);
    expect(run).toMatchObject({ status: 'calculated', employeeCount: 1, totals: { net: m('52000.00') } });
  });

  it('PAY-02 joiner on 15 Feb 2027 (14 of 28 days): 22,500.00 with the joiner warning', T, async () => {
    const s = await scenario('PAY-02');
    const b = await employee(s.f, { joiningDate: '2027-02-15' });
    await structure(s.f, b.id, '45000.00', '2027-02-15');
    const run = await runTo(s, 2027, 2, 'calculated');
    const it = await itemOf(s, run.id, b.id);
    expect(net(it)).toBe('22500.00');
    expect(it.daysEmployed).toBe(14);
    expect(it.validationFlags).toEqual(['joiner']);
  });

  it('PAY-03 leaver with last day 20 Mar 2027: 24,838.71 with the leaver warning', T, async () => {
    const s = await scenario('PAY-03');
    const c = await employee(s.f, { separationDate: '2027-03-20', status: 'separated' });
    await structure(s.f, c.id, '38500.00');
    const run = await runTo(s, 2027, 3, 'calculated');
    const it = await itemOf(s, run.id, c.id);
    expect(net(it)).toBe('24838.71');
    expect(it.validationFlags).toEqual(['leaver']);
  });

  it(
    'PAY-04 mid-period change: two prorated base lines (D-041), both structures in the snapshot',
    T,
    async () => {
      const s = await scenario('PAY-04');
      const d = await employee(s.f);
      const old = await structure(s.f, d.id, '40000.00', '2025-01-01', '2027-01-15');
      const neu = await structure(s.f, d.id, '46000.00', '2027-01-16');
      const run = await runTo(s, 2027, 1, 'calculated');
      const it = await itemOf(s, run.id, d.id);
      const detail = await itemDetail(s, run.id, it.id);
      expect(detail.lines.map((l) => [l.label, l.amount.amount])).toEqual([
        ['Base salary (2027-01-01 to 2027-01-15)', '19354.84'],
        ['Base salary (2027-01-16 to 2027-01-31)', '23741.94'],
      ]);
      expect(net(it)).toBe('43096.78');
      const snap = detail.snapshot as {
        salaryStructures: { id: string }[];
        lines: { calculation: { days: number } }[];
      };
      expect(snap.salaryStructures.map((x) => x.id)).toEqual([old, neu]);
      expect(snap.lines.map((l) => l.calculation.days)).toEqual([15, 16]);
    },
  );

  it(
    'PAY-04 with the mid-period policy cleared: 422 PAYROLL_MIDPERIOD_SALARY_CHANGE_UNCONFIRMED',
    T,
    async () => {
      const s = await scenario('PAY-04b');
      const d = await employee(s.f);
      await structure(s.f, d.id, '40000.00', '2025-01-01', '2027-01-15');
      await structure(s.f, d.id, '46000.00', '2027-01-16');
      await setSetting(s.f, 'payroll.midperiod_salary_change_policy', null);
      const run = await runTo(s, 2027, 1, 'draft');
      const res = await post(s.po, `/payroll/runs/${run.id}/calculate`, { version: run.version });
      expect(res.status).toBe(422);
      expect((await json(res)).code).toBe('PAYROLL_MIDPERIOD_SALARY_CHANGE_UNCONFIRMED');
      expect((await ok<Run>(get(s.po, `/payroll/runs/${run.id}`))).status).toBe('draft');
    },
  );

  it(
    'PAY-05 approved claims up to the period end are paid; later and unapproved claims wait',
    T,
    async () => {
      const s = await scenario('PAY-05');
      const e = await employee(s.f);
      await structure(s.f, e.id, '30000.00');
      const rc1 = await claim(s.f, e.id, '450.00', '2026-12-10');
      const rc2 = await claim(s.f, e.id, '1275.50', '2026-12-28');
      const rc3 = await claim(s.f, e.id, '800.00', '2027-01-02');
      const rc4 = await claim(s.f, e.id, '300.00', null, 'submitted');
      const run = await runTo(s, 2026, 12, 'calculated');
      const it = await itemOf(s, run.id, e.id);
      expect(it).toMatchObject({
        grossAmount: m('31725.50'),
        deductionAmount: m('0.00'),
        netAmount: m('31725.50'),
      });
      const lines = (await itemDetail(s, run.id, it.id)).lines;
      expect(lines.map((l) => [l.code, l.amount.amount, l.sourceId])).toEqual([
        ['base_salary', '30000.00', expect.any(String)],
        ['reimbursement', '450.00', rc1],
        ['reimbursement', '1275.50', rc2],
      ]);
      // Claims stay approved until lock (BUSINESS-RULES 6.8)
      const before = await s.f.db
        .select()
        .from(schema.reimbursementClaims)
        .where(inArray(schema.reimbursementClaims.id, [rc1, rc2]));
      expect(before.map((c) => c.status)).toEqual(['approved', 'approved']);

      await lock(s, await approve(s, await submit(s, run)));
      const rows = await s.f.db
        .select()
        .from(schema.reimbursementClaims)
        .where(inArray(schema.reimbursementClaims.id, [rc1, rc2, rc3, rc4]));
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(rc1)).toMatchObject({ status: 'included', payrollItemId: it.id });
      expect(byId.get(rc2)).toMatchObject({ status: 'included', payrollItemId: it.id });
      expect(byId.get(rc3)?.status).toBe('approved');
      expect(byId.get(rc4)?.status).toBe('submitted');
    },
  );

  it('PAY-06 leave and absences do not change pay (D-017)', T, async () => {
    const s = await scenario('PAY-06');
    const e = await employee(s.f);
    await structure(s.f, e.id, '36000.00');
    const run = await runTo(s, 2026, 11, 'calculated');
    const it = await itemOf(s, run.id, e.id);
    expect(net(it)).toBe('36000.00');
    expect((await itemDetail(s, run.id, it.id)).lines.every((l) => l.kind === 'earning')).toBe(true);
  });

  it(
    'PAY-07 approved addition and deduction apply; the pending one is ignored; both move to applied',
    T,
    async () => {
      const s = await scenario('PAY-07');
      const g = await employee(s.f);
      await structure(s.f, g.id, '35000.00');
      const p = await period(s, 2026, 11);
      const adj = async (type: string, amount: string, reason: string) =>
        ok<{ id: string; version: number }>(
          post(s.po, '/payroll/adjustments', {
            employeeId: g.id,
            type,
            amount: m(amount),
            reason,
            targetPeriodId: p.id,
          }),
          201,
        );
      const add = await adj('addition', '2000.00', 'one-off allowance approved by director');
      const ded = await adj('deduction', '1500.00', 'recovery of October overpayment');
      const pending = await adj('deduction', '700.00', 'still under discussion');
      for (const a of [add, ded])
        await ok(post(s.director, `/payroll/adjustments/${a.id}/approve`, { version: a.version }));

      let run = await calculate(s, await createRun(s, p.id));
      const it = await itemOf(s, run.id, g.id);
      expect(it).toMatchObject({
        grossAmount: m('37000.00'),
        deductionAmount: m('1500.00'),
        netAmount: m('35500.00'),
      });
      run = await lock(s, await approve(s, await submit(s, run)));
      const rows = await s.f.db
        .select()
        .from(schema.payrollAdjustments)
        .where(inArray(schema.payrollAdjustments.id, [add.id, ded.id, pending.id]));
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(add.id)).toMatchObject({ status: 'applied', appliedPayrollItemId: it.id });
      expect(byId.get(ded.id)).toMatchObject({ status: 'applied', appliedPayrollItemId: it.id });
      expect(byId.get(pending.id)?.status).toBe('pending');
      expect((await auditFor(s.f.db, add.id)).map((a) => a.action)).toEqual([
        'payroll_adjustment.created',
        'payroll_adjustment.approved',
        'payroll_adjustment.applied',
      ]);
    },
  );

  it('PAY-07 negative net guard: submit is blocked with PAYROLL_NEGATIVE_NET', T, async () => {
    const s = await scenario('PAY-07b');
    const g = await employee(s.f);
    await structure(s.f, g.id, '1000.00');
    const p = await period(s, 2026, 11);
    const a = await ok<{ id: string; version: number }>(
      post(s.po, '/payroll/adjustments', {
        employeeId: g.id,
        type: 'deduction',
        amount: m('1500.00'),
        reason: 'recovery larger than pay',
        targetPeriodId: p.id,
      }),
      201,
    );
    await ok(post(s.director, `/payroll/adjustments/${a.id}/approve`, { version: a.version }));
    const run = await calculate(s, await createRun(s, p.id));
    const it = await itemOf(s, run.id, g.id);
    expect(net(it)).toBe('-500.00');
    expect(it.validationFlags).toContain('negative_net');
    const res = await post(s.po, `/payroll/runs/${run.id}/submit`, { version: run.version });
    expect(res.status).toBe(422);
    const body = await json<{ code: string; errors: { path: string; code: string }[] }>(res);
    expect(body.code).toBe('PAYROLL_NEGATIVE_NET');
    expect(body.errors).toEqual([expect.objectContaining({ path: `/items/${it.id}`, code: 'negative_net' })]);
  });

  it(
    'PAY-09 returned run: history kept, corrected structure recalculated, audit shows old and new gross',
    T,
    async () => {
      const s = await scenario('PAY-09');
      const h = await employee(s.f);
      const wrong = await structure(s.f, h.id, '55000.00', '2026-12-01');
      let run = await runTo(s, 2026, 12, 'submitted');
      expect(net(await itemOf(s, run.id, h.id))).toBe('55000.00');

      run = await ok<Run>(
        post(s.director, `/payroll/runs/${run.id}/return`, {
          reason: 'E-H gross wrong',
          version: run.version,
        }),
      );
      expect(run).toMatchObject({ status: 'draft', returnedReason: 'E-H gross wrong' });

      const fix = await ok<{ id: string; version: number }>(
        post(s.po, '/salary-structures', {
          employeeId: h.id,
          grossAmount: m('50000.00'),
          effectiveFrom: '2026-12-01',
          reason: 'Correct entry error',
        }),
        201,
      );
      await ok(post(s.po, `/salary-structures/${fix.id}/approve`, { version: fix.version }));
      const [old] = await s.f.db
        .select()
        .from(schema.salaryStructures)
        .where(eq(schema.salaryStructures.id, wrong));
      expect(old?.status).toBe('superseded');
      const approvedAudit = (await auditFor(s.f.db, fix.id)).find(
        (a) => a.action === 'salary_structure.approved',
      );
      expect(approvedAudit).toMatchObject({ category: 'payroll' });
      expect(approvedAudit?.metadata).toMatchObject({ grossAmount: { from: '55000.00', to: '50000.00' } });

      run = await calculate(s, run);
      expect(net(await itemOf(s, run.id, h.id))).toBe('50000.00');
      run = await approve(s, await submit(s, run));
      expect(run.status).toBe('approved');

      const history = (await auditFor(s.f.db, run.id)).map((a) => {
        const md = a.metadata as { from?: string; to?: string; next?: string };
        return md.next ? `${md.to}>${md.next}` : (md.to ?? a.action);
      });
      expect(history).toEqual([
        'payroll_run.created',
        'calculated',
        'submitted',
        'returned>draft',
        'calculated',
        'submitted',
        'approved',
      ]);
      expect((await auditFor(s.f.db, run.id)).every((a) => a.actorUserId !== null && a.occurredAt)).toBe(
        true,
      );
    },
  );

  it('PAY-10 locked run is never edited; arrears go through an adjustment in the next run', T, async () => {
    const s = await scenario('PAY-10');
    const i = await employee(s.f);
    await structure(s.f, i.id, '50000.00');
    const nov = await runTo(s, 2026, 11, 'locked');
    const novItem = await itemOf(s, nov.id, i.id);

    // No endpoint can change the locked run
    const recalc = await post(s.po, `/payroll/runs/${nov.id}/calculate`, { version: nov.version });
    expect(recalc.status).toBe(409);
    expect((await json(recalc)).code).toBe('PAYROLL_RUN_LOCKED');
    const ret = await post(s.director, `/payroll/runs/${nov.id}/return`, {
      reason: 'reopen',
      version: nov.version,
    });
    expect(ret.status).toBe(409);
    expect((await json(ret)).code).toBe('PAYROLL_RUN_LOCKED');
    // and the database guard refuses a direct change too
    await expect(
      s.f.db
        .update(schema.payrollItems)
        .set({ netAmount: '1.00', grossAmount: '1.00' })
        .where(eq(schema.payrollItems.id, novItem.id)),
    ).rejects.toThrow();

    // The increment from 1 Dec, and arrears for November through an adjustment
    const inc = await ok<{ id: string; version: number }>(
      post(s.po, '/salary-structures', {
        employeeId: i.id,
        grossAmount: m('52000.00'),
        effectiveFrom: '2026-12-01',
        reason: 'Annual increment',
      }),
      201,
    );
    await ok(post(s.po, `/salary-structures/${inc.id}/approve`, { version: inc.version }));
    const dec = await period(s, 2026, 12);
    const novPeriodId = (
      await ok<{ data: { id: string; month: number }[] }>(get(s.po, '/payroll/periods'))
    ).data.find((x) => x.month === 11)?.id;
    const closed = await post(s.po, '/payroll/adjustments', {
      employeeId: i.id,
      type: 'addition',
      lineCode: 'arrears',
      amount: m('2000.00'),
      reason: 'Arrears: November increment',
      targetPeriodId: novPeriodId,
    });
    expect(closed.status).toBe(409);
    expect((await json(closed)).code).toBe('PAYROLL_RUN_LOCKED');
    const arrears = await ok<{ id: string; version: number }>(
      post(s.po, '/payroll/adjustments', {
        employeeId: i.id,
        type: 'addition',
        lineCode: 'arrears',
        amount: m('2000.00'),
        reason: 'Arrears: November increment',
        targetPeriodId: dec.id,
        correctsPayrollItemId: novItem.id,
      }),
      201,
    );
    await ok(post(s.director, `/payroll/adjustments/${arrears.id}/approve`, { version: arrears.version }));
    const run = await calculate(s, await createRun(s, dec.id));
    const it = await itemOf(s, run.id, i.id);
    expect(net(it)).toBe('54000.00');
    expect((await itemDetail(s, run.id, it.id)).lines.map((l) => [l.code, l.kind, l.amount.amount])).toEqual([
      ['base_salary', 'earning', '52000.00'],
      ['arrears', 'earning', '2000.00'],
    ]);
    // November is unchanged
    expect(net(await itemOf(s, nov.id, i.id))).toBe('50000.00');
  });

  it('PAY-12 rounding edge cases (half-up once per line)', T, async () => {
    const s = await scenario('PAY-12');
    const a = await employee(s.f, { joiningDate: '2027-01-10' });
    await structure(s.f, a.id, '33333.33', '2027-01-10');
    const b = await employee(s.f, { joiningDate: '2027-01-31' });
    await structure(s.f, b.id, '10000.01', '2027-01-31');
    const c = await employee(s.f, { joiningDate: '2026-11-30' });
    await structure(s.f, c.id, '30000.15', '2026-11-30');
    const d = await employee(s.f, { separationDate: '2027-01-17' });
    await structure(s.f, d.id, '27500.00');
    const e = await employee(s.f, { joiningDate: '2028-02-15' });
    await structure(s.f, e.id, '29000.00', '2028-02-15');

    const nov = await runTo(s, 2026, 11, 'calculated');
    expect(net(await itemOf(s, nov.id, c.id))).toBe('1000.01'); // PAY-12c
    const jan = await runTo(s, 2027, 1, 'calculated');
    expect(net(await itemOf(s, jan.id, a.id))).toBe('23655.91'); // PAY-12a
    expect(net(await itemOf(s, jan.id, b.id))).toBe('322.58'); // PAY-12b
    expect(net(await itemOf(s, jan.id, d.id))).toBe('15080.65'); // PAY-12d
    // PAY-12d's employee has separated before February 2028 and is not in that run
    await s.f.db.update(schema.employees).set({ status: 'separated' }).where(eq(schema.employees.id, d.id));
    const feb = await runTo(s, 2028, 2, 'calculated');
    expect(net(await itemOf(s, feb.id, e.id))).toBe('15000.00'); // PAY-12e
    expect((await items(s, feb.id)).map((x) => x.employee.id)).not.toContain(d.id);
  });

  it(
    'PAY-13a/b/c missing structure blocks submit; joiners after and leavers before the period are not included',
    T,
    async () => {
      const s = await scenario('PAY-13a');
      const ok1 = await employee(s.f);
      await structure(s.f, ok1.id, '30000.00');
      const j = await employee(s.f);
      const future = await employee(s.f, { joiningDate: '2027-02-01' });
      await structure(s.f, future.id, '30000.00', '2027-02-01');
      const gone = await employee(s.f, { separationDate: '2026-12-31', status: 'separated' });
      await structure(s.f, gone.id, '30000.00');

      const run = await runTo(s, 2027, 1, 'calculated');
      const all = await items(s, run.id);
      expect(all.map((x) => x.employee.id).sort()).toEqual([ok1.id, j.id].sort());
      const jItem = all.find((x) => x.employee.id === j.id) as (typeof all)[number];
      expect(jItem.validationFlags).toContain('no_salary_structure');
      expect(net(all.find((x) => x.employee.id === ok1.id) as (typeof all)[number])).toBe('30000.00');

      const detail = await ok<Run>(get(s.po, `/payroll/runs/${run.id}`));
      expect(detail.validation).toMatchObject({ blockingCode: 'PAYROLL_MISSING_SALARY_STRUCTURE' });

      const res = await post(s.po, `/payroll/runs/${run.id}/submit`, { version: run.version });
      expect(res.status).toBe(422);
      const body = await json<{ code: string; errors: { path: string; code: string }[] }>(res);
      expect(body.code).toBe('PAYROLL_MISSING_SALARY_STRUCTURE');
      expect(body.errors).toEqual([
        expect.objectContaining({ path: `/items/${jItem.id}`, code: 'no_salary_structure' }),
      ]);

      // Fixed by adding the structure and recalculating
      await structure(s.f, j.id, '20000.00');
      const again = await calculate(s, run);
      expect((await submit(s, again)).status).toBe('submitted');
    },
  );

  it('PAY-13d net change over 20% from the previous locked run is a warning, not a block', T, async () => {
    const s = await scenario('PAY-13d');
    const e = await employee(s.f);
    await structure(s.f, e.id, '30000.00', '2025-01-01', '2026-11-30');
    await structure(s.f, e.id, '40000.00', '2026-12-01');
    await runTo(s, 2026, 11, 'locked');
    const dec = await runTo(s, 2026, 12, 'calculated');
    expect((await itemOf(s, dec.id, e.id)).validationFlags).toEqual(['net_change_over_threshold']);
    expect((await submit(s, dec)).status).toBe('submitted');

    // a higher threshold clears the warning on re-validation
    await setSetting(s.f, 'payroll.anomaly_threshold_percent', 50);
    const v = await ok<{ items: unknown[]; summary: { warningItems: number } }>(
      post(s.po, `/payroll/runs/${dec.id}/validate`),
    );
    expect(v.items).toEqual([]);
    expect(v.summary.warningItems).toBe(0);
  });
});
