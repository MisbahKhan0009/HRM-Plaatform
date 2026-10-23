import { jsonValue, schema, uuidv7 } from '@hrm/db';
import { eq } from 'drizzle-orm';
import { expect } from 'vitest';
import { call, type Fixture, setupCompany, type TestUser } from '../harness';

/** Shared fixtures for the payroll API tests (docs/07-quality/PAYROLL-TEST-CASES.md). */

export const HOOK_TIMEOUT = 180_000;

export const key = () => ({ 'Idempotency-Key': crypto.randomUUID() });
export const m = (amount: string) => ({ amount, currency: 'BDT' });

export type Run = {
  id: string;
  runNumber: string;
  period: { id: string };
  preparedBy: string | null;
  preparedByName: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  status: string;
  version: number;
  selfApproved: boolean;
  selfApprovalNote: string | null;
  returnedReason: string | null;
  employeeCount: number | null;
  totals: { gross: { amount: string }; deductions: { amount: string }; net: { amount: string } } | null;
  validation?: { blockingCode: string | null; byFlag: Record<string, number> };
};

export type Item = {
  id: string;
  employee: { id: string; employeeCode: string };
  grossAmount: { amount: string };
  deductionAmount: { amount: string };
  netAmount: { amount: string };
  daysEmployed: number;
  validationFlags: string[];
  paymentStatus: string;
};

export interface Scenario {
  f: Fixture;
  /** payroll_officer: prepare, approve, lock, pay */
  po: TestUser;
  /** director: approve only */
  director: TestUser;
}

export async function scenario(name: string): Promise<Scenario> {
  const f = await setupCompany(name);
  const po = await f.signIn({ roles: ['payroll_officer'], name: 'Pat Payroll' });
  const director = await f.signIn({ roles: ['director'], name: 'Dana Director' });
  return { f, po, director };
}

export function post(
  user: TestUser,
  path: string,
  body: unknown = {},
  headers: Record<string, string> = key(),
) {
  return call('POST', `/api/v1${path}`, { cookie: user.cookie, body, headers });
}

export function get(user: TestUser, path: string) {
  return call('GET', `/api/v1${path}`, { cookie: user.cookie });
}

export async function ok<T>(res: Response | Promise<Response>, status = 200): Promise<T> {
  const r = await res;
  const text = await r.text();
  expect(r.status, text).toBe(status);
  return JSON.parse(text) as T;
}

/** An employee with optional separation date (fixtures write the row directly; the employees module is separate). */
export async function employee(
  f: Fixture,
  o: {
    joiningDate?: string;
    separationDate?: string;
    status?: 'active' | 'separated' | 'probation';
    userId?: string;
  } = {},
) {
  const id = await f.employee({
    joiningDate: o.joiningDate ?? '2025-01-01',
    status: o.status ?? 'active',
    ...(o.userId ? { userId: o.userId } : {}),
  });
  if (o.separationDate)
    await f.db
      .update(schema.employees)
      .set({ separationDate: o.separationDate })
      .where(eq(schema.employees.id, id));
  const [row] = await f.db.select().from(schema.employees).where(eq(schema.employees.id, id));
  return { id, code: row?.employeeCode as string };
}

/** An approved salary structure written directly (the API flow is tested in payroll-structures.test.ts). */
export async function structure(
  f: Fixture,
  employeeId: string,
  gross: string,
  from = '2025-01-01',
  to: string | null = null,
  currency = 'BDT',
) {
  const id = uuidv7();
  await f.db.insert(schema.salaryStructures).values({
    id,
    companyId: f.companyId,
    employeeId,
    grossAmount: gross,
    effectiveFrom: from,
    effectiveTo: to,
    currency,
    status: 'approved',
    approvedAt: new Date(),
  });
  return id;
}

let claimSeq = 0;
/** A claim in a given status, decided at the business date given (Asia/Dhaka noon). */
export async function claim(
  f: Fixture,
  employeeId: string,
  amount: string,
  decidedOn: string | null,
  status = 'approved',
) {
  const id = uuidv7();
  claimSeq += 1;
  await f.db.insert(schema.reimbursementClaims).values({
    id,
    companyId: f.companyId,
    claimNumber: `RC-T${Date.now().toString(36)}${claimSeq}`,
    employeeId,
    expenseDate: decidedOn ?? '2026-11-01',
    amount,
    description: 'Transport',
    status,
    submittedAt: new Date(),
    decidedAt: decidedOn ? new Date(`${decidedOn}T06:00:00Z`) : null,
  });
  return id;
}

export async function period(s: Scenario, year: number, month: number) {
  return ok<{ id: string; startDate: string; endDate: string }>(
    post(s.po, '/payroll/periods', { year, month }),
    201,
  );
}

export async function createRun(s: Scenario, periodId: string, runType = 'regular') {
  return ok<Run>(post(s.po, '/payroll/runs', { periodId, runType }), 201);
}

export async function calculate(s: Scenario, run: Run) {
  return ok<Run>(post(s.po, `/payroll/runs/${run.id}/calculate`, { version: run.version }));
}

export async function submit(s: Scenario, run: Run) {
  return ok<Run>(post(s.po, `/payroll/runs/${run.id}/submit`, { version: run.version }));
}

export async function approve(s: Scenario, run: Run) {
  return ok<Run>(post(s.director, `/payroll/runs/${run.id}/approve`, { version: run.version }));
}

export async function lock(s: Scenario, run: Run) {
  return ok<Run>(post(s.po, `/payroll/runs/${run.id}/lock`, { version: run.version }));
}

/** Creates the period and a regular run and moves it to `target`. */
export async function runTo(
  s: Scenario,
  year: number,
  month: number,
  target: 'draft' | 'calculated' | 'submitted' | 'approved' | 'locked',
) {
  const p = await period(s, year, month);
  let run = await createRun(s, p.id);
  if (target === 'draft') return run;
  run = await calculate(s, run);
  if (target === 'calculated') return run;
  run = await submit(s, run);
  if (target === 'submitted') return run;
  run = await approve(s, run);
  if (target === 'approved') return run;
  return lock(s, run);
}

export async function items(s: Scenario, runId: string) {
  return (await ok<{ data: Item[] }>(get(s.po, `/payroll/runs/${runId}/items?pageSize=100`))).data;
}

export async function itemOf(s: Scenario, runId: string, employeeId: string) {
  const all = await items(s, runId);
  const it = all.find((i) => i.employee.id === employeeId);
  if (!it) throw new Error('item not found');
  return it;
}

export async function itemDetail(s: Scenario, runId: string, itemId: string) {
  return ok<
    Item & {
      lines: {
        kind: string;
        code: string;
        label: string;
        amount: { amount: string };
        sourceId: string | null;
      }[];
      snapshot: Record<string, unknown>;
    }
  >(get(s.po, `/payroll/runs/${runId}/items/${itemId}`));
}

export const net = (i: Item) => i.netAmount.amount;

export async function setSetting(f: Fixture, key: string, value: unknown) {
  await f.db
    .insert(schema.settings)
    .values({ companyId: f.companyId, key, scope: 'payroll', value: jsonValue(value) })
    .onConflictDoUpdate({
      target: [schema.settings.companyId, schema.settings.key],
      set: { value: jsonValue(value) },
    });
}
