import { schema, uuidv7 } from '@hrm/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { call, type Fixture, json, setupCompany, type TestUser } from '../harness';

let f: Fixture;
let hr: TestUser;
let payroll: TestUser;
let director: TestUser;
let mgr: TestUser;
let plain: TestUser;
let emp1: string;
let emp1b: string;
let emp2: string;
let leaver: string;
let eng: string;
let ops: string;
let runId: string;
let draftRunId: string;
let other: Fixture;
let otherRunId: string;

interface Page<T> {
  data: T[];
  page: { number: number; size: number; totalItems: number; totalPages: number };
  summary?: Record<string, unknown>;
}

const get = async <T>(path: string, user: TestUser) => {
  const res = await call('GET', path, { cookie: user.cookie });
  return { status: res.status, body: res.status === 200 ? await json<Page<T>>(res) : await json(res) };
};

async function payrollRun(
  fx: Fixture,
  period: string,
  number: string,
  status: 'approved' | 'draft',
  type = 'regular',
) {
  const id = uuidv7();
  await fx.db.insert(schema.payrollRuns).values({
    id,
    companyId: fx.companyId,
    payrollPeriodId: period,
    runNumber: number,
    runType: type,
    status,
  });
  return id;
}

async function item(
  run: string,
  employeeId: string,
  amounts: { gross: string; deduction: string; net: string },
  lines: {
    kind: 'earning' | 'deduction';
    code: 'base_salary' | 'reimbursement' | 'deduction';
    label: string;
    amount: string;
  }[],
) {
  const id = uuidv7();
  await f.db.insert(schema.payrollItems).values({
    id,
    companyId: f.companyId,
    payrollRunId: run,
    employeeId,
    grossAmount: amounts.gross,
    deductionAmount: amounts.deduction,
    netAmount: amounts.net,
    daysInPeriod: 31,
    daysEmployed: 31,
    snapshot: {},
    validationFlags: ['salary_change'],
  });
  if (lines.length)
    await f.db
      .insert(schema.payrollLineItems)
      .values(lines.map((l, i) => ({ id: uuidv7(), payrollItemId: id, sortOrder: i, ...l })));
  return id;
}

beforeAll(async () => {
  f = await setupCompany('Reports Co');
  other = await setupCompany('Other Reports Co');
  hr = await f.signIn({ roles: ['hr_admin'] });
  payroll = await f.signIn({ roles: ['payroll_officer'] });
  director = await f.signIn({ roles: ['director'] });
  plain = await f.signIn({ employee: true, strong: false });

  eng = uuidv7();
  ops = uuidv7();
  await f.db.insert(schema.departments).values([
    { id: eng, companyId: f.companyId, code: 'ENG', name: 'Engineering' },
    { id: ops, companyId: f.companyId, code: 'OPS', name: 'Operations' },
  ]);
  mgr = await f.signIn({
    employee: { departmentId: eng, firstName: 'Mina', lastName: 'Manager' },
    strong: false,
  });
  emp1 = await f.employee({
    managerId: mgr.employeeId,
    departmentId: eng,
    firstName: 'Arif',
    lastName: 'One',
  });
  emp1b = await f.employee({ managerId: emp1, departmentId: eng, status: 'probation', firstName: 'Bina' });
  emp2 = await f.employee({ departmentId: ops, firstName: 'Chand', lastName: 'Two' });
  leaver = await f.employee({ departmentId: ops, status: 'separated' });
  await f.db
    .update(schema.employees)
    .set({ separationDate: '2026-03-31' })
    .where(eq(schema.employees.id, leaver));

  // Attendance: emp1 (team) and emp2 (outside the team).
  const day = (
    employeeId: string,
    workDate: string,
    status: 'present' | 'absent' | 'short_hours',
    worked: number,
  ) => ({
    id: uuidv7(),
    companyId: f.companyId,
    employeeId,
    workDate,
    status,
    workedMinutes: worked,
    lateMinutes: status === 'short_hours' ? 30 : 0,
    needsReview: status === 'short_hours',
    isFinal: true,
  });
  await f.db
    .insert(schema.attendanceRecords)
    .values([
      day(emp1, '2026-03-01', 'present', 480),
      day(emp1, '2026-03-02', 'short_hours', 300),
      day(emp1, '2026-03-03', 'absent', 0),
      day(emp1, '2026-05-01', 'present', 480),
      day(emp2, '2026-03-01', 'present', 500),
    ]);

  // Leave: seeded Casual leave type and policy.
  const [cl] = await f.db
    .select({ id: schema.leaveTypes.id })
    .from(schema.leaveTypes)
    .where(and(eq(schema.leaveTypes.companyId, f.companyId), eq(schema.leaveTypes.code, 'CL')));
  const [policy] = await f.db
    .select({ id: schema.leavePolicies.id })
    .from(schema.leavePolicies)
    .where(eq(schema.leavePolicies.leaveTypeId, cl?.id as string));
  const balance = (employeeId: string, used: string) => ({
    employeeId,
    leaveTypeId: cl?.id as string,
    leaveYear: 2026,
    companyId: f.companyId,
    entitled: '10.00',
    used,
  });
  await f.db.insert(schema.leaveBalances).values([balance(emp1, '2.00'), balance(emp2, '1.00')]);
  const request = (
    employeeId: string,
    n: string,
    start: string,
    end: string,
    units: string,
    status: string,
  ) => ({
    id: uuidv7(),
    companyId: f.companyId,
    requestNumber: n,
    employeeId,
    leaveTypeId: cl?.id as string,
    leavePolicyId: policy?.id as string,
    startDate: start,
    endDate: end,
    requestedUnits: units,
    status,
  });
  await f.db
    .insert(schema.leaveRequests)
    .values([
      request(emp1, 'LV-1', '2026-03-10', '2026-03-11', '2.00', 'approved'),
      request(emp1, 'LV-2', '2026-06-10', '2026-06-10', '1.00', 'pending'),
      request(emp2, 'LV-3', '2026-03-15', '2026-03-15', '1.00', 'approved'),
    ]);

  // Payroll: an approved March run and a draft off-cycle run in the same year.
  const period = uuidv7();
  await f.db.insert(schema.payrollPeriods).values({
    id: period,
    companyId: f.companyId,
    year: 2026,
    month: 3,
    startDate: '2026-03-01',
    endDate: '2026-03-31',
  });
  runId = await payrollRun(f, period, 'PR-0001', 'approved');
  draftRunId = await payrollRun(f, period, 'PR-0002', 'draft', 'off_cycle');
  const item1 = await item(runId, emp1, { gross: '50800.00', deduction: '1500.00', net: '49300.00' }, [
    { kind: 'earning', code: 'base_salary', label: 'Base salary', amount: '50000.00' },
    { kind: 'earning', code: 'reimbursement', label: 'Transport', amount: '800.00' },
    { kind: 'deduction', code: 'deduction', label: 'Advance recovery', amount: '1500.00' },
  ]);
  const item2 = await item(runId, emp2, { gross: '40000.00', deduction: '0.00', net: '40000.00' }, [
    { kind: 'earning', code: 'base_salary', label: 'Base salary', amount: '40000.00' },
  ]);
  await item(draftRunId, emp2, { gross: '1000.00', deduction: '100.00', net: '900.00' }, [
    { kind: 'deduction', code: 'deduction', label: 'Draft deduction', amount: '100.00' },
  ]);
  await f.db.insert(schema.payrollPayments).values([
    {
      id: uuidv7(),
      companyId: f.companyId,
      payrollItemId: item1,
      method: 'cash',
      amount: '49300.00',
      paidOn: '2026-04-01',
    },
    {
      id: uuidv7(),
      companyId: f.companyId,
      payrollItemId: item2,
      method: 'cheque',
      chequeNumber: 'CHQ-1',
      amount: '20000.00',
      paidOn: '2026-04-02',
    },
    {
      id: uuidv7(),
      companyId: f.companyId,
      payrollItemId: item2,
      method: 'cash',
      amount: '5000.00',
      paidOn: '2026-04-03',
      status: 'cancelled',
      cancelledReason: 'Recorded twice',
    },
  ]);

  // Reimbursement claims.
  const claim = (n: string, employeeId: string, expenseDate: string, amount: string, status: string) => ({
    id: uuidv7(),
    companyId: f.companyId,
    claimNumber: n,
    employeeId,
    expenseDate,
    amount,
    description: 'Taxi to client',
    status,
  });
  await f.db
    .insert(schema.reimbursementClaims)
    .values([
      claim('RC-1', emp1, '2026-03-05', '350.00', 'approved'),
      claim('RC-2', emp2, '2026-03-06', '120.50', 'submitted'),
      claim('RC-3', emp2, '2026-03-07', '999.00', 'draft'),
      claim('RC-4', emp1, '2026-07-01', '50.00', 'rejected'),
    ]);

  const otherPeriod = uuidv7();
  await other.db.insert(schema.payrollPeriods).values({
    id: otherPeriod,
    companyId: other.companyId,
    year: 2026,
    month: 3,
    startDate: '2026-03-01',
    endDate: '2026-03-31',
  });
  otherRunId = await payrollRun(other, otherPeriod, 'PR-0001', 'approved');
});

describe('headcount', () => {
  it('counts employees employed on asOf by department and status', async () => {
    const { status, body } = await get<{
      groupId: string;
      groupLabel: string;
      total: number;
      byStatus: Record<string, number>;
    }>('/api/v1/reports/headcount?asOf=2026-03-15', hr);
    expect(status).toBe(200);
    const page = body as Page<{
      groupId: string;
      groupLabel: string;
      total: number;
      byStatus: Record<string, number>;
    }>;
    const engRow = page.data.find((r) => r.groupId === eng);
    const opsRow = page.data.find((r) => r.groupId === ops);
    expect(engRow).toMatchObject({ groupLabel: 'Engineering', total: 3 });
    expect(engRow?.byStatus).toMatchObject({ active: 2, probation: 1, separated: 0 });
    expect(opsRow).toMatchObject({ groupLabel: 'Operations', total: 2 });
    expect(opsRow?.byStatus.separated).toBe(1);
  });

  it('drops employees separated before asOf and groups by status', async () => {
    const { body } = await get<{ groupLabel: string; total: number }>(
      `/api/v1/reports/headcount?asOf=2026-04-15&departmentId=${ops}&groupBy=status`,
      director,
    );
    const page = body as Page<{ groupLabel: string; total: number; groupId?: string }>;
    expect(page.data).toEqual([expect.objectContaining({ groupLabel: 'active', total: 1 })]);
    expect(page.data[0]).not.toHaveProperty('groupId');
    expect(page.summary).toEqual({ asOf: '2026-04-15', total: 1 });
  });

  it('returns 403 without report.hr and 400 for a bad grouping', async () => {
    expect((await get('/api/v1/reports/headcount', mgr)).status).toBe(403);
    expect((await get('/api/v1/reports/headcount', payroll)).status).toBe(403);
    expect((await get('/api/v1/reports/headcount?groupBy=salary', hr)).status).toBe(400);
  });
});

describe('directory', () => {
  it('limits report.team to the manager’s direct and indirect reports', async () => {
    const { status, body } = await get<{ employeeId: string }>('/api/v1/reports/directory?pageSize=100', mgr);
    expect(status).toBe(200);
    const ids = (body as Page<{ employeeId: string }>).data.map((r) => r.employeeId).sort();
    expect(ids).toEqual([emp1, emp1b].sort());
  });

  it('shows HR every employee, filtered by status, without any salary field', async () => {
    const { body } = await get<Record<string, unknown>>(
      '/api/v1/reports/directory?status=probation&pageSize=100',
      hr,
    );
    const page = body as Page<Record<string, unknown>>;
    expect(page.data.map((r) => r.employeeId)).toEqual([emp1b]);
    expect(page.data[0]).toMatchObject({
      departmentName: 'Engineering',
      managerName: 'Arif One',
      status: 'probation',
    });
    expect(JSON.stringify(page)).not.toMatch(/gross|salary|amount/i);
    const all = (await get<{ employeeId: string }>('/api/v1/reports/directory?pageSize=2', hr))
      .body as Page<unknown>;
    expect(all.data).toHaveLength(2);
    expect(all.page.totalItems).toBeGreaterThanOrEqual(5);
  });

  it('returns 403 to an employee and 400 for an unknown filter', async () => {
    expect((await get('/api/v1/reports/directory', plain)).status).toBe(403);
    expect((await get('/api/v1/reports/directory?salary=1', hr)).status).toBe(400);
  });
});

describe('attendance', () => {
  type Row = {
    employeeId: string;
    days: Record<string, number>;
    workedMinutes: number;
    lateMinutes: number;
    needsReview: number;
  };

  it('summarises records in the range per employee', async () => {
    const { status, body } = await get<Row>('/api/v1/reports/attendance?from=2026-03-01&to=2026-03-31', hr);
    expect(status).toBe(200);
    const row = (body as Page<Row>).data.find((r) => r.employeeId === emp1);
    expect(row).toMatchObject({ workedMinutes: 780, lateMinutes: 30, needsReview: 1 });
    expect(row?.days).toMatchObject({ present: 1, shortHours: 1, absent: 1 });
    expect((body as Page<Row>).data.map((r) => r.employeeId)).toContain(emp2);
  });

  it('gives a manager only their team, even when filtering by an outside employee', async () => {
    const team = (await get<Row>('/api/v1/reports/attendance?from=2026-03-01&to=2026-03-31', mgr))
      .body as Page<Row>;
    expect(team.data.map((r) => r.employeeId)).toEqual([emp1]);
    const outside = (
      await get<Row>(`/api/v1/reports/attendance?from=2026-03-01&to=2026-03-31&employeeId=${emp2}`, mgr)
    ).body as Page<Row>;
    expect(outside.data).toEqual([]);
  });

  it('requires an ordered range of at most 366 days', async () => {
    expect((await get('/api/v1/reports/attendance', hr)).status).toBe(400);
    expect((await get('/api/v1/reports/attendance?from=2026-03-31&to=2026-03-01', hr)).status).toBe(400);
    expect((await get('/api/v1/reports/attendance?from=2025-01-01&to=2026-03-01', hr)).status).toBe(400);
    expect((await get('/api/v1/reports/attendance?from=2026-01-01&to=2026-01-31', payroll)).status).toBe(403);
  });
});

describe('leave', () => {
  type Row = {
    employeeId: string;
    leaveTypeCode: string;
    entitled: string;
    used: string;
    available: string;
    takenInPeriod: string;
  };

  it('reports balances and approved leave taken in the period', async () => {
    const { status, body } = await get<Row>('/api/v1/reports/leave?from=2026-03-01&to=2026-03-31', hr);
    expect(status).toBe(200);
    const rows = (body as Page<Row>).data;
    expect(rows.find((r) => r.employeeId === emp1)).toMatchObject({
      leaveTypeCode: 'CL',
      entitled: '10.00',
      used: '2.00',
      available: '8.00',
      takenInPeriod: '2.00',
    });
    expect(rows.find((r) => r.employeeId === emp2)?.takenInPeriod).toBe('1.00');
  });

  it('limits a manager to the team and requires both ends of a range', async () => {
    const team = (await get<Row>('/api/v1/reports/leave?year=2026', mgr)).body as Page<Row>;
    expect(team.data.map((r) => r.employeeId)).toEqual([emp1]);
    expect(team.data[0]?.takenInPeriod).toBe('2.00');
    expect((await get('/api/v1/reports/leave?from=2026-03-01', hr)).status).toBe(400);
    expect((await get('/api/v1/reports/leave?year=2026', plain)).status).toBe(403);
  });
});

describe('payroll reports', () => {
  type Money = { amount: string; currency: string };

  it('returns the payroll register with string money and run totals', async () => {
    const { status, body } = await get<{
      employeeId: string;
      netAmount: Money;
      reimbursementAmount: Money;
      validationFlags: string[];
    }>(`/api/v1/reports/payroll-register?runId=${runId}`, payroll);
    expect(status).toBe(200);
    const page = body as Page<{
      employeeId: string;
      netAmount: Money;
      reimbursementAmount: Money;
      validationFlags: string[];
    }>;
    const row = page.data.find((r) => r.employeeId === emp1);
    expect(row?.netAmount).toEqual({ amount: '49300.00', currency: 'BDT' });
    expect(row?.reimbursementAmount.amount).toBe('800.00');
    expect(row?.validationFlags).toEqual(['salary_change']);
    expect(page.summary).toMatchObject({
      run: { id: runId, runNumber: 'PR-0001', periodYear: 2026, periodMonth: 3 },
      totals: { employeeCount: 2, grossAmount: { amount: '90800.00' }, netAmount: { amount: '89300.00' } },
    });
  });

  it('is not available to HR (no report.payroll) and returns 404 for another company’s run', async () => {
    expect((await get(`/api/v1/reports/payroll-register?runId=${runId}`, hr)).status).toBe(403);
    expect((await get(`/api/v1/reports/payroll-register?runId=${otherRunId}`, payroll)).status).toBe(404);
    expect((await get('/api/v1/reports/payroll-register', payroll)).status).toBe(400);
  });

  it('lists deduction lines for a run, or for a year’s approved runs only', async () => {
    type Row = { label: string; amount: Money; runNumber: string };
    const byRun = (await get<Row>(`/api/v1/reports/payroll-deductions?runId=${draftRunId}`, payroll))
      .body as Page<Row>;
    expect(byRun.data.map((r) => r.label)).toEqual(['Draft deduction']);
    const byYear = (await get<Row>('/api/v1/reports/payroll-deductions?year=2026', director))
      .body as Page<Row>;
    expect(byYear.data.map((r) => [r.runNumber, r.label, r.amount.amount])).toEqual([
      ['PR-0001', 'Advance recovery', '1500.00'],
    ]);
    expect(byYear.summary).toEqual({ totalAmount: { amount: '1500.00', currency: 'BDT' } });
    expect((await get('/api/v1/reports/payroll-deductions', payroll)).status).toBe(400);
    expect((await get(`/api/v1/reports/payroll-deductions?year=2026&runId=${runId}`, payroll)).status).toBe(
      400,
    );
    expect((await get(`/api/v1/reports/payroll-deductions?runId=${otherRunId}`, payroll)).status).toBe(404);
  });

  it('reconciles net pay against valid payments', async () => {
    type Row = {
      employeeId: string;
      paidAmount: Money;
      differenceAmount: Money;
      paymentCount: number;
      methods: string[];
    };
    const { status, body } = await get<Row>(`/api/v1/reports/payment-reconciliation?runId=${runId}`, payroll);
    expect(status).toBe(200);
    const page = body as Page<Row>;
    expect(page.data.find((r) => r.employeeId === emp1)).toMatchObject({
      paidAmount: { amount: '49300.00' },
      differenceAmount: { amount: '0.00' },
      paymentCount: 1,
      methods: ['cash'],
    });
    expect(page.data.find((r) => r.employeeId === emp2)).toMatchObject({
      paidAmount: { amount: '20000.00' },
      differenceAmount: { amount: '20000.00' },
      paymentCount: 1,
      methods: ['cheque'],
    });
    expect(page.summary).toMatchObject({
      totals: { paidAmount: { amount: '69300.00' }, differenceAmount: { amount: '20000.00' } },
    });
    expect((await get(`/api/v1/reports/payment-reconciliation?runId=${runId}`, mgr)).status).toBe(403);
  });
});

describe('reimbursements', () => {
  type Row = { claimNumber: string; amount: { amount: string }; status: string };

  it('lists non-draft claims in the range to HR and payroll', async () => {
    const { status, body } = await get<Row>(
      '/api/v1/reports/reimbursements?from=2026-03-01&to=2026-03-31',
      hr,
    );
    expect(status).toBe(200);
    const page = body as Page<Row>;
    expect(page.data.map((r) => r.claimNumber)).toEqual(['RC-1', 'RC-2']);
    expect(page.summary).toEqual({ count: 2, totalAmount: { amount: '470.50', currency: 'BDT' } });
    const approved = (
      await get<Row>(
        '/api/v1/reports/reimbursements?from=2026-01-01&to=2026-12-31&status=approved,rejected',
        payroll,
      )
    ).body as Page<Row>;
    expect(approved.data.map((r) => r.claimNumber)).toEqual(['RC-1', 'RC-4']);
  });

  it('returns 403 to a manager and 400 for a draft status filter', async () => {
    expect((await get('/api/v1/reports/reimbursements?from=2026-03-01&to=2026-03-31', mgr)).status).toBe(403);
    expect(
      (await get('/api/v1/reports/reimbursements?from=2026-03-01&to=2026-03-31&status=draft', hr)).status,
    ).toBe(400);
  });
});

describe('exports', () => {
  const exportsBy = (userId: string) =>
    f.db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.actorUserId, userId), eq(schema.auditLogs.action, 'report.exported')));

  it('audits report.exported with the report, filters and row count', async () => {
    const res = await call('POST', '/api/v1/reports/exports', {
      cookie: mgr.cookie,
      body: {
        report: 'attendance',
        format: 'xlsx',
        filters: { from: '2026-03-01', to: '2026-03-31' },
        rowCount: 1,
      },
    });
    expect(res.status).toBe(204);
    const [row] = await exportsBy(mgr.userId);
    expect(row).toMatchObject({ category: 'business', entityType: 'report' });
    expect(row?.metadata).toEqual({
      report: 'attendance',
      format: 'xlsx',
      filters: { from: '2026-03-01', to: '2026-03-31' },
      rowCount: 1,
    });
  });

  it('records payroll exports in the payroll category', async () => {
    const res = await call('POST', '/api/v1/reports/exports', {
      cookie: payroll.cookie,
      body: { report: 'payroll_register', filters: { runId }, rowCount: 2 },
    });
    expect(res.status).toBe(204);
    expect((await exportsBy(payroll.userId))[0]?.category).toBe('payroll');
  });

  it('needs the report’s permission and a valid body', async () => {
    const forbidden = await call('POST', '/api/v1/reports/exports', {
      cookie: hr.cookie,
      body: { report: 'payroll_register', filters: {}, rowCount: 2 },
    });
    expect(forbidden.status).toBe(403);
    expect(await exportsBy(hr.userId)).toHaveLength(0);
    const invalid = await call('POST', '/api/v1/reports/exports', {
      cookie: hr.cookie,
      body: { report: 'salaries', filters: {}, rowCount: -1 },
    });
    expect(invalid.status).toBe(400);
  });
});
