import { env as workerEnv } from 'cloudflare:workers';
import { schema, uuidv7 } from '@hrm/db';
import { addDays, balanceDelta, proratedAnnualGrant, toBusinessDate, zonedInstant } from '@hrm/domain';
import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DailyContext, DailyStep } from '../../src/jobs/dispatcher';
import { type JobOutcome, runJob } from '../../src/jobs/run-job';
import { DAILY_STEPS } from '../../src/jobs/steps';
import { fixedClock } from '../../src/lib/clock';
import { createDeps } from '../../src/lib/deps';
import {
  leaveAccrueStep,
  leaveCarryForwardExpiryStep,
  leaveEligibilityGrantsStep,
  leaveYearEndStep,
} from '../../src/modules/leave/leave.jobs';
import { type Fixture, setupCompany } from '../harness';

// Secrets are declared on the global Env (src/env.d.ts), not on Cloudflare.Env.
const env = workerEnv as unknown as Env;

let f: Fixture;
let types: Record<string, string>;
let policies: Record<string, string>;

/** Runs steps like the dispatcher does at 00:05 Dhaka on `date`, but for this file's company only. */
async function runOn(date: string, steps: readonly DailyStep[]): Promise<Record<string, JobOutcome>> {
  const at = zonedInstant(date, '00:05');
  const deps = createDeps(env, fixedClock(at), {
    requestId: `test-${date}`,
    ipAddress: null,
    userAgent: null,
  });
  const today = toBusinessDate(at);
  const ctx: DailyContext = { deps, companyId: f.companyId, today, yesterday: addDays(today, -1) };
  const out: Record<string, JobOutcome> = {};
  try {
    for (const step of steps) {
      if (!step.runsOn(today)) continue;
      out[step.job] = await runJob(deps, f.companyId, step.job, step.runKey(ctx), (tx) => step.run(tx, ctx));
    }
  } finally {
    await deps.close();
  }
  return out;
}

async function entries(employeeId: string, code?: string) {
  const rows = await f.db
    .select({
      type: schema.leaveLedgerEntries.type,
      amount: schema.leaveLedgerEntries.amount,
      year: schema.leaveLedgerEntries.leaveYear,
      date: schema.leaveLedgerEntries.effectiveDate,
      code: schema.leaveTypes.code,
      jobRunId: schema.leaveLedgerEntries.jobRunId,
    })
    .from(schema.leaveLedgerEntries)
    .innerJoin(schema.leaveTypes, eq(schema.leaveTypes.id, schema.leaveLedgerEntries.leaveTypeId))
    .where(eq(schema.leaveLedgerEntries.employeeId, employeeId))
    .orderBy(schema.leaveLedgerEntries.effectiveDate, schema.leaveTypes.code, schema.leaveLedgerEntries.type);
  return rows
    .filter((r) => !code || r.code === code)
    .map((r) => `${r.year} ${r.code} ${r.type} ${r.amount} @${r.date}`);
}

async function available(employeeId: string, code: string, year: number) {
  const [row] = await f.db
    .select({ available: schema.leaveBalances.available, entitled: schema.leaveBalances.entitled })
    .from(schema.leaveBalances)
    .where(
      and(
        eq(schema.leaveBalances.employeeId, employeeId),
        eq(schema.leaveBalances.leaveTypeId, types[code] as string),
        eq(schema.leaveBalances.leaveYear, year),
      ),
    );
  return row?.available ?? null;
}

/** Test fixture posting: one ledger entry and the matching balance move (BUSINESS-RULES 4.1). */
async function post(
  employeeId: string,
  code: string,
  year: number,
  type: 'grant' | 'adjustment' | 'usage',
  amount: string,
  leaveRequestId: string | null = null,
) {
  const d = balanceDelta(type, amount);
  await f.db.insert(schema.leaveLedgerEntries).values({
    id: uuidv7(),
    companyId: f.companyId,
    employeeId,
    leaveTypeId: types[code] as string,
    leaveYear: year,
    type,
    amount,
    effectiveDate: `${year}-06-01`,
    leaveRequestId,
    reason: type === 'adjustment' ? 'fixture' : null,
  });
  await f.db
    .insert(schema.leaveBalances)
    .values({
      employeeId,
      leaveTypeId: types[code] as string,
      leaveYear: year,
      companyId: f.companyId,
      entitled: d.entitled.toFixed(2),
      used: d.used.toFixed(2),
      reserved: d.reserved.toFixed(2),
      adjusted: d.adjusted.toFixed(2),
    })
    .onConflictDoUpdate({
      target: [
        schema.leaveBalances.employeeId,
        schema.leaveBalances.leaveTypeId,
        schema.leaveBalances.leaveYear,
      ],
      set: {
        entitled: sql`${schema.leaveBalances.entitled} + ${d.entitled.toFixed(2)}::numeric`,
        used: sql`${schema.leaveBalances.used} + ${d.used.toFixed(2)}::numeric`,
        adjusted: sql`${schema.leaveBalances.adjusted} + ${d.adjusted.toFixed(2)}::numeric`,
      },
    });
}

/** Attendance records for an employee: `count` consecutive days from `from` with one status. */
async function attendance(employeeId: string, from: string, count: number, status: string) {
  await f.db.execute(sql`
    INSERT INTO attendance_records (id, company_id, employee_id, work_date, status, is_final)
    SELECT gen_random_uuid(), ${f.companyId}, ${employeeId}, ${from}::date + g, ${status}::attendance_status, true
    FROM generate_series(0, ${count - 1}) g`);
}

beforeAll(async () => {
  f = await setupCompany('Leave Jobs Co');
  const rows = await f.db
    .select({ id: schema.leaveTypes.id, code: schema.leaveTypes.code })
    .from(schema.leaveTypes)
    .where(eq(schema.leaveTypes.companyId, f.companyId));
  types = Object.fromEntries(rows.map((r) => [r.code, r.id]));
  // EL: annual 12, carry up to 4, carried days expire 3 months into the year. MA: monthly 1.25, max balance 2.
  for (const [code, policy] of [
    [
      'EL',
      {
        allocationMethod: 'annual_grant',
        annualEntitlement: '12',
        maxCarryForward: '4',
        carryForwardExpiryMonths: 3,
      },
    ],
    ['MA', { allocationMethod: 'monthly_accrual', accrualPerMonth: '1.25', maxBalance: '2' }],
  ] as const) {
    const id = uuidv7();
    await f.db
      .insert(schema.leaveTypes)
      .values({ id, companyId: f.companyId, code, name: code, sortOrder: 9 });
    await f.db.insert(schema.leavePolicies).values({
      id: uuidv7(),
      companyId: f.companyId,
      leaveTypeId: id,
      effectiveFrom: '2026-01-01',
      ...policy,
    });
    types[code] = id;
  }
  const pols = await f.db
    .select({ id: schema.leavePolicies.id, typeId: schema.leavePolicies.leaveTypeId })
    .from(schema.leavePolicies)
    .where(eq(schema.leavePolicies.companyId, f.companyId));
  policies = Object.fromEntries(pols.map((p) => [p.typeId, p.id]));
}, 60_000);

describe('leave.eligibility_grants (BUSINESS-RULES 5.1)', () => {
  let joins20: string;
  let joins10: string;
  let veteran: string;
  let future: string;
  let draft: string;

  beforeAll(async () => {
    joins20 = await f.employee({ joiningDate: '2026-03-20', status: 'probation' });
    joins10 = await f.employee({ joiningDate: '2026-03-10', status: 'probation' });
    veteran = await f.employee({ joiningDate: '2024-05-01' });
    future = await f.employee({ joiningDate: '2026-04-01', status: 'probation' });
    draft = await f.employee({ status: 'draft' });
  });

  it('grants prorated entitlements on the eligibility date, matching the domain function', async () => {
    expect(await runOn('2026-03-20', [leaveEligibilityGrantsStep])).toEqual({
      'leave.eligibility_grants': 'succeeded',
    });
    // CL 10 × 9/12 = 7.5; SL 14 × 9/12 = 10.5; EL 12 × 9/12 = 9.
    expect(await entries(joins20)).toEqual([
      '2026 CL grant 7.50 @2026-03-20',
      '2026 EL grant 9.00 @2026-03-20',
      '2026 SL grant 10.50 @2026-03-20',
    ]);
    // Joined 10 March: 10 months. CL 8.33 → 8; SL 11.67 → 11.5; EL 10.
    expect(await entries(joins10)).toEqual([
      '2026 CL grant 8.00 @2026-03-20',
      '2026 EL grant 10.00 @2026-03-20',
      '2026 SL grant 11.50 @2026-03-20',
    ]);
    for (const [emp, date] of [
      [joins20, '2026-03-20'],
      [joins10, '2026-03-10'],
    ] as const) {
      expect(await available(emp, 'CL', 2026)).toBe(proratedAnnualGrant('10', date, true).toFixed(2));
      expect(await available(emp, 'SL', 2026)).toBe(proratedAnnualGrant('14', date, true).toFixed(2));
    }
    // Eligible before 1 January without a grant this year (go-live): the full entitlement.
    expect(await entries(veteran)).toEqual([
      '2026 CL grant 10.00 @2026-03-20',
      '2026 EL grant 12.00 @2026-03-20',
      '2026 SL grant 14.00 @2026-03-20',
    ]);
    expect(await entries(future)).toEqual([]);
    expect(await entries(draft)).toEqual([]);
    const [run] = await f.db
      .select({ id: schema.jobRuns.id })
      .from(schema.jobRuns)
      .where(
        and(eq(schema.jobRuns.companyId, f.companyId), eq(schema.jobRuns.job, 'leave.eligibility_grants')),
      );
    const [entry] = await f.db
      .select({ jobRunId: schema.leaveLedgerEntries.jobRunId })
      .from(schema.leaveLedgerEntries)
      .where(eq(schema.leaveLedgerEntries.employeeId, joins20));
    expect(entry?.jobRunId).toBe(run?.id);
  });

  it('is idempotent: the same day is skipped and later days grant nothing twice', async () => {
    expect(await runOn('2026-03-20', [leaveEligibilityGrantsStep])).toEqual({
      'leave.eligibility_grants': 'skipped',
    });
    await runOn('2026-03-21', [leaveEligibilityGrantsStep]);
    expect(await entries(joins20)).toHaveLength(3);
    await runOn('2026-04-01', [leaveEligibilityGrantsStep]);
    // Joins 1 April: 9 months. CL 7.5; SL 10.5; EL 9.
    expect(await entries(future)).toEqual([
      '2026 CL grant 7.50 @2026-04-01',
      '2026 EL grant 9.00 @2026-04-01',
      '2026 SL grant 10.50 @2026-04-01',
    ]);
  });
});

describe('leave.accrue (BUSINESS-RULES 5.2, 5.3)', () => {
  let worker: string;
  let newcomer: string;
  let nearCap: string;

  beforeAll(async () => {
    worker = await f.employee({ joiningDate: '2025-01-01' });
    newcomer = await f.employee({ joiningDate: '2026-01-15' });
    nearCap = await f.employee({ joiningDate: '2024-01-01' });
    // 40 present + 10 short_hours + 5 missed_core count; 10 absent and 3 on_leave do not: 55 worked days.
    await attendance(worker, '2026-01-04', 40, 'present');
    await attendance(worker, '2026-03-01', 10, 'short_hours');
    await attendance(worker, '2026-04-01', 5, 'missed_core');
    await attendance(worker, '2026-05-01', 10, 'absent');
    await attendance(worker, '2026-06-01', 3, 'on_leave');
    await attendance(newcomer, '2026-02-01', 60, 'present');
    await attendance(nearCap, '2026-01-04', 36, 'present');
    await post(nearCap, 'AL', 2026, 'adjustment', '39.50');
  });

  it('posts per-days-worked accrual: floor_to_half(55 / 18) = 3.0, capped at max_balance, nothing before eligibility', async () => {
    expect(await runOn('2026-09-01', [leaveAccrueStep])).toEqual({ 'leave.accrue': 'succeeded' });
    expect(await entries(worker, 'AL')).toEqual(['2026 AL accrual 3.00 @2026-08-31']);
    // 36 days → 2.0 earned, but available may not exceed 40: 0.5 posted.
    expect(await entries(nearCap, 'AL')).toEqual([
      '2026 AL adjustment 39.50 @2026-06-01',
      '2026 AL accrual 0.50 @2026-08-31',
    ]);
    expect(await available(nearCap, 'AL', 2026)).toBe('40.00');
    expect(await entries(newcomer, 'AL')).toEqual([]);
  });

  it('posts monthly accrual to everyone eligible, capped by max_balance', async () => {
    expect(await entries(worker, 'MA')).toEqual(['2026 MA accrual 1.25 @2026-08-31']);
    await runOn('2026-10-01', [leaveAccrueStep]);
    // 1.25 + 1.25 would exceed max_balance 2: only 0.75 posted.
    expect(await entries(worker, 'MA')).toEqual([
      '2026 MA accrual 1.25 @2026-08-31',
      '2026 MA accrual 0.75 @2026-09-30',
    ]);
  });

  it('posts only the difference next month, and running twice posts nothing new', async () => {
    await attendance(worker, '2026-09-01', 18, 'present');
    await runOn('2026-11-01', [leaveAccrueStep]); // October accrual: 73 days → 4.0, 3.0 already → 1.0
    const once = await entries(worker, 'AL');
    expect(once).toEqual(['2026 AL accrual 3.00 @2026-08-31', '2026 AL accrual 1.00 @2026-10-31']);
    expect(await runOn('2026-11-01', [leaveAccrueStep])).toEqual({ 'leave.accrue': 'skipped' });
    // The step itself is idempotent too (unique index), even outside job_runs.
    const deps = createDeps(env, fixedClock(new Date('2026-10-31T18:05:00Z')), {
      requestId: null,
      ipAddress: null,
      userAgent: null,
    });
    await deps.db.transaction((tx) =>
      leaveAccrueStep.run(tx, { deps, companyId: f.companyId, today: '2026-11-01', yesterday: '2026-10-31' }),
    );
    await deps.close();
    expect(await entries(worker, 'AL')).toEqual(once);
  });
});

describe('leave.year_end and leave.carry_forward_expiry (BUSINESS-RULES 5.4)', () => {
  let saver: string;

  beforeAll(async () => {
    saver = await f.employee({ joiningDate: '2020-01-01' });
    await post(saver, 'CL', 2026, 'grant', '10');
    await post(saver, 'CL', 2026, 'adjustment', '-4');
    await post(saver, 'EL', 2026, 'grant', '12');
    await post(saver, 'EL', 2026, 'adjustment', '-6');
  });

  it('expires what cannot be carried, carries up to the limit, then grants the new year', async () => {
    const outcomes = await runOn('2027-01-01', DAILY_STEPS);
    expect(outcomes).toMatchObject({
      'leave.accrue': 'succeeded',
      'leave.year_end': 'succeeded',
      'leave.eligibility_grants': 'succeeded',
    });
    // CL: 6 available, no carry-forward (NULL): all 6 expire. EL: 6 available, carry 4, expire 2.
    expect(await entries(saver, 'CL')).toContain('2026 CL expiry -6.00 @2026-12-31');
    expect(await entries(saver, 'EL')).toEqual([
      '2026 EL grant 12.00 @2026-06-01',
      '2026 EL adjustment -6.00 @2026-06-01',
      '2026 EL expiry -2.00 @2026-12-31',
      '2027 EL grant 12.00 @2027-01-01',
      '2027 EL carry_forward 4.00 @2027-01-01',
    ]);
    expect(await available(saver, 'CL', 2026)).toBe('0.00');
    expect(await available(saver, 'EL', 2027)).toBe('16.00');
    expect(await available(saver, 'CL', 2027)).toBe('10.00');
    expect(await runOn('2027-01-01', [leaveYearEndStep])).toEqual({ 'leave.year_end': 'skipped' });
  });

  it('expires unused carried days on the expiry date; usage consumes carried days first', async () => {
    const requestId = uuidv7();
    await f.db.insert(schema.leaveRequests).values({
      id: requestId,
      companyId: f.companyId,
      requestNumber: 'LV-900001',
      employeeId: saver,
      leaveTypeId: types.EL as string,
      leavePolicyId: policies[types.EL as string] as string,
      startDate: '2027-02-02',
      endDate: '2027-02-02',
      requestedUnits: '1.00',
      status: 'approved',
    });
    await post(saver, 'EL', 2027, 'usage', '-1', requestId);
    expect(await runOn('2027-03-01', [leaveCarryForwardExpiryStep])).toEqual({
      'leave.carry_forward_expiry': 'succeeded',
    });
    expect((await entries(saver, 'EL')).some((e) => e.startsWith('2027 EL expiry'))).toBe(false);
    await runOn('2027-04-01', [leaveCarryForwardExpiryStep]);
    // carry 4 - usage 1 = 3 expire; 16 - 1 - 3 = 12 left.
    expect(await entries(saver, 'EL')).toContain('2027 EL expiry -3.00 @2027-04-01');
    expect(await available(saver, 'EL', 2027)).toBe('12.00');
  });

  it('keeps every balance equal to the sum of its ledger entries', async () => {
    const rows = await f.db.execute<{ mismatches: number }>(sql`
      SELECT count(*)::int AS mismatches FROM leave_balances b
      LEFT JOIN (
        SELECT employee_id, leave_type_id, leave_year, sum(amount) AS total FROM leave_ledger_entries
        WHERE company_id = ${f.companyId} GROUP BY 1, 2, 3
      ) l USING (employee_id, leave_type_id, leave_year)
      WHERE b.company_id = ${f.companyId} AND b.available <> coalesce(l.total, 0)`);
    expect(rows[0]?.mismatches).toBe(0);
  });
});
