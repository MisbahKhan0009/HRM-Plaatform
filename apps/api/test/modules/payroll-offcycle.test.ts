import { schema, uuidv7 } from '@hrm/db';
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
  ok,
  period,
  post,
  type Run,
  runTo,
  type Scenario,
  scenario,
  structure,
  submit,
} from './payroll-helpers';

// Off-cycle runs (BUSINESS-RULES 6.10): only approved claims and adjustments not yet paid by any run.

const T = { timeout: HOOK_TIMEOUT };

/** An approved adjustment written directly, so it can target a closed period (the API refuses that). */
async function approvedAdjustment(
  s: Scenario,
  employeeId: string,
  periodId: string,
  type: 'addition' | 'deduction',
  amount: string,
) {
  const id = uuidv7();
  await s.f.db.insert(schema.payrollAdjustments).values({
    id,
    companyId: s.f.companyId,
    employeeId,
    type,
    lineCode: type,
    amount,
    reason: `${type} for the off-cycle test`,
    targetPeriodId: periodId,
    status: 'approved',
    decidedAt: new Date(),
  });
  return id;
}

const calcRes = (s: Scenario, run: Run) =>
  post(s.po, `/payroll/runs/${run.id}/calculate`, { version: run.version });

async function claimStatuses(s: Scenario, ids: string[]) {
  const rows = await s.f.db
    .select({ id: schema.reimbursementClaims.id, status: schema.reimbursementClaims.status })
    .from(schema.reimbursementClaims)
    .where(inArray(schema.reimbursementClaims.id, ids));
  return Object.fromEntries(rows.map((r) => [r.id, r.status]));
}

describe('off-cycle calculate', () => {
  it(
    'pays claims and adjustments after the regular run is locked, including a separated employee, through payslips',
    T,
    async () => {
      const s = await scenario('Off-cycle lifecycle Co');
      const e = await employee(s.f);
      const idle = await employee(s.f);
      const left = await employee(s.f, { joiningDate: '2025-01-01', separationDate: '2027-08-15' });
      await structure(s.f, e.id, '30000.00');
      await structure(s.f, idle.id, '20000.00');
      await structure(s.f, left.id, '31000.00');
      const p = await period(s, 2027, 8);
      const regular = await lock(
        s,
        await approve(s, await submit(s, await calculate(s, await createRun(s, p.id)))),
      );
      expect(regular.status).toBe('locked');
      await s.f.db
        .update(schema.employees)
        .set({ status: 'separated' })
        .where(eq(schema.employees.id, left.id));

      // A5: the separated employee's claim is approved after the final regular run was calculated.
      const lateClaim = await claim(s.f, left.id, '400.00', '2027-09-03');
      const eClaim = await claim(s.f, e.id, '650.00', '2027-09-02');
      const add = await approvedAdjustment(s, e.id, p.id, 'addition', '1000.00');
      const ded = await approvedAdjustment(s, e.id, p.id, 'deduction', '250.50');

      // The period is closed; an off-cycle run may still be created and calculated for it.
      let off = await createRun(s, p.id, 'off_cycle');
      expect(off.runNumber).toBe('PR-2027-08-02');
      off = await calculate(s, off);
      expect(off).toMatchObject({ status: 'calculated', employeeCount: 2 });
      expect(off.totals).toMatchObject({ gross: m('2050.00'), deductions: m('250.50'), net: m('1799.50') });

      const all = await items(s, off.id);
      expect(all.map((i) => i.employee.id).sort()).toEqual([e.id, left.id].sort());
      const ei = await itemOf(s, off.id, e.id);
      expect(ei).toMatchObject({
        grossAmount: m('1650.00'),
        deductionAmount: m('250.50'),
        netAmount: m('1399.50'),
        daysEmployed: 0,
        validationFlags: [],
      });
      const li = await itemOf(s, off.id, left.id);
      expect(li).toMatchObject({ netAmount: m('400.00'), validationFlags: [] });
      const detail = await itemDetail(s, off.id, ei.id);
      expect(detail.lines.map((l) => [l.kind, l.code, l.amount.amount, l.sourceId])).toEqual([
        ['earning', 'reimbursement', '650.00', eClaim],
        ['earning', 'addition', '1000.00', add],
        ['deduction', 'deduction', '250.50', ded],
      ]);
      expect(detail.snapshot).toMatchObject({ runType: 'off_cycle', salaryStructures: [], daysEmployed: 0 });

      // validate keeps the off-cycle flag rules
      await ok(post(s.po, `/payroll/runs/${off.id}/validate`));
      expect((await itemOf(s, off.id, left.id)).validationFlags).toEqual([]);

      off = await submit(s, off);
      off = await approve(s, off);
      off = await lock(s, off);
      expect(await claimStatuses(s, [lateClaim, eClaim])).toEqual({
        [lateClaim]: 'included',
        [eClaim]: 'included',
      });
      const adjustments = await s.f.db
        .select({ status: schema.payrollAdjustments.status })
        .from(schema.payrollAdjustments)
        .where(inArray(schema.payrollAdjustments.id, [add, ded]));
      expect(adjustments.map((a) => a.status)).toEqual(['applied', 'applied']);
      expect(
        (await auditFor(s.f.db, off.id)).find((a) => a.action === 'payroll_run.locked')?.metadata,
      ).toMatchObject({ includedClaims: 2, appliedAdjustments: 2 });

      // Payments, mark paid and payslips work unchanged.
      for (const it of [ei, li])
        await ok(
          post(s.po, `/payroll/runs/${off.id}/payments`, {
            payrollItemId: it.id,
            method: 'cash',
            amount: it.netAmount,
            paidOn: '2027-09-10',
            reference: `ACK-${it.employee.employeeCode}`,
          }),
          201,
        );
      const current = await ok<Run>(get(s.po, `/payroll/runs/${off.id}`));
      const paid = await ok<Run>(
        post(s.po, `/payroll/runs/${off.id}/mark-paid`, { version: current.version }),
      );
      expect(paid.status).toBe('paid');
      expect(await claimStatuses(s, [lateClaim, eClaim])).toEqual({ [lateClaim]: 'paid', [eClaim]: 'paid' });
      expect(
        (await ok<{ published: number }>(post(s.po, `/payroll/runs/${off.id}/publish-payslips`))).published,
      ).toBe(2);
      const slips = await ok<{
        data: { id: string; runType: string; runNumber: string; employee: { id: string } }[];
      }>(get(s.po, `/payroll/payslips?periodId=${p.id}&pageSize=100`));
      const slip = slips.data.find((x) => x.runNumber === off.runNumber && x.employee.id === e.id);
      expect(slip?.runType).toBe('off_cycle');
      const data = await ok<{ runType: string; daysEmployed: number; lines: { code: string }[] }>(
        get(s.po, `/payroll/payslips/${slip?.id}`),
      );
      expect(data.runType).toBe('off_cycle');
      expect(data.daysEmployed).toBe(0);
      expect(data.lines.map((l) => l.code)).toEqual(['reimbursement', 'addition', 'deduction']);

      // Nothing is paid twice: another off-cycle run has nothing to pay, and the next regular run skips them.
      const again = await createRun(s, p.id, 'off_cycle');
      const empty = await calcRes(s, again);
      expect(empty.status).toBe(422);
      expect(await json(empty)).toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
      expect((await ok<Run>(get(s.po, `/payroll/runs/${again.id}`))).status).toBe('draft');
      const next = await runTo(s, 2027, 9, 'calculated');
      const nextE = await itemDetail(s, next.id, (await itemOf(s, next.id, e.id)).id);
      expect(nextE.lines.map((l) => l.code)).toEqual(['base_salary']);
      expect((await items(s, next.id)).some((i) => i.employee.id === left.id)).toBe(false);
    },
  );

  it(
    'a regular run and an off-cycle run of the same period never take the same claim or adjustment',
    T,
    async () => {
      const s = await scenario('Off-cycle overlap Co');
      const e = await employee(s.f);
      await structure(s.f, e.id, '30000.00');
      const p = await period(s, 2027, 10);
      const c1 = await claim(s.f, e.id, '300.00', '2027-10-05');
      const a1 = await approvedAdjustment(s, e.id, p.id, 'addition', '500.00');

      // Off-cycle first: the regular run calculated afterwards skips what the off-cycle run holds.
      let off = await calculate(s, await createRun(s, p.id, 'off_cycle'));
      expect(off.totals?.net.amount).toBe('800.00');
      let regular = await calculate(s, await createRun(s, p.id));
      let lines = (await itemDetail(s, regular.id, (await itemOf(s, regular.id, e.id)).id)).lines;
      expect(lines.map((l) => l.sourceId)).not.toContain(c1);
      expect(lines.map((l) => l.sourceId)).not.toContain(a1);

      // Returned off-cycle run releases them; the recalculated regular run takes them, and the off-cycle has nothing.
      off = await ok<Run>(
        post(s.director, `/payroll/runs/${off.id}/return`, {
          version: off.version,
          reason: 'Pay in the regular run',
        }),
      );
      regular = await calculate(s, regular);
      lines = (await itemDetail(s, regular.id, (await itemOf(s, regular.id, e.id)).id)).lines;
      expect(lines.map((l) => l.code)).toEqual(['base_salary', 'reimbursement', 'addition']);
      const res = await calcRes(s, off);
      expect(res.status).toBe(422);
      expect((await json(res)).code).toBe('BUSINESS_RULE_VIOLATION');

      regular = await lock(s, await approve(s, await submit(s, regular)));
      expect(await claimStatuses(s, [c1])).toEqual({ [c1]: 'included' });
      expect((await calcRes(s, off)).status).toBe(422);
    },
  );

  it('a negative net blocks submit', T, async () => {
    const s = await scenario('Off-cycle negative Co');
    const e = await employee(s.f);
    const p = await period(s, 2027, 12);
    await claim(s.f, e.id, '100.00', '2027-12-02');
    await approvedAdjustment(s, e.id, p.id, 'deduction', '500.00');
    const off = await calculate(s, await createRun(s, p.id, 'off_cycle'));
    const it = await itemOf(s, off.id, e.id);
    expect(it).toMatchObject({ netAmount: m('-400.00'), validationFlags: ['negative_net'] });
    const res = await post(s.po, `/payroll/runs/${off.id}/submit`, { version: off.version });
    expect(res.status).toBe(422);
    expect((await json(res)).code).toBe('PAYROLL_NEGATIVE_NET');
  });

  it('requires payroll.prepare (403) and hides another company run (404)', T, async () => {
    const s = await scenario('Off-cycle access Co');
    const other = await scenario('Off-cycle other Co');
    const e = await employee(s.f);
    const p = await period(s, 2028, 1);
    await claim(s.f, e.id, '100.00', '2028-01-02');
    const off = await createRun(s, p.id, 'off_cycle');
    const staff = await s.f.signIn({ employee: true, strong: false });
    expect(
      (await post(s.director, `/payroll/runs/${off.id}/calculate`, { version: off.version })).status,
    ).toBe(403);
    expect((await post(staff, `/payroll/runs/${off.id}/calculate`, { version: off.version })).status).toBe(
      403,
    );
    expect((await post(other.po, `/payroll/runs/${off.id}/calculate`, { version: off.version })).status).toBe(
      404,
    );
    expect((await post(s.po, `/payroll/runs/${off.id}/calculate`, { version: 'x' })).status).toBe(400);
    expect((await ok<Run>(get(s.po, `/payroll/runs/${off.id}`))).status).toBe('draft');
  });
});
