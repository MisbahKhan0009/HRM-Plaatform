import { env as workerEnv } from 'cloudflare:workers';
import { schema } from '@hrm/db';
import { addDays, toBusinessDate, zonedInstant } from '@hrm/domain';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { runJob } from '../../src/jobs/run-job';
import { fixedClock } from '../../src/lib/clock';
import { createDeps } from '../../src/lib/deps';
import { leaveEligibilityGrantsStep } from '../../src/modules/leave/leave.jobs';
import { call, type Fixture, json, setupCompany, type TestUser } from '../harness';

// Secrets are declared on the global Env (src/env.d.ts), not on Cloudflare.Env.
const env = workerEnv as unknown as Env;

/** Clock of every import call in this file: business date 2026-03-01 in Asia/Dhaka. */
const NOW = '2026-03-01T06:00:00Z';

type Preview = {
  previewToken: string;
  mapping: Record<string, string | null>;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicates: number[];
  errors: { row: number; path: string; code: string }[];
};
type Result = {
  createdCount: number;
  skippedCount: number;
  created: { row: number; id: string; employeeCode: string; status: string }[];
  errors: { row: number; code: string }[];
};

let f: Fixture;
let hr: TestUser;
let staff: TestUser;

const preview = (body: Record<string, unknown>, cookie = hr.cookie) =>
  call('POST', '/api/v1/employees/import/preview', { cookie, body, now: NOW });
const commit = (body: Record<string, unknown>, key: string, cookie = hr.cookie) =>
  call('POST', '/api/v1/employees/import/commit', {
    cookie,
    body,
    headers: { 'Idempotency-Key': key },
    now: NOW,
  });

beforeAll(async () => {
  f = await setupCompany('Import Co');
  hr = await f.signIn({ roles: ['hr_admin'] });
  staff = await f.signIn({ employee: true, strong: false });
  await call('POST', '/api/v1/departments', {
    cookie: hr.cookie,
    body: { code: 'ENG', name: 'Engineering' },
  });
  await call('POST', '/api/v1/positions', { cookie: hr.cookie, body: { title: 'Engineer' } });
  await f.db.insert(schema.employees).values({
    id: crypto.randomUUID(),
    companyId: f.companyId,
    employeeCode: 'EMP-0007',
    firstName: 'Existing',
    lastName: 'Boss',
    workEmail: 'boss@example.test',
    status: 'active',
    joiningDate: '2020-01-01',
  });
}, 30_000);

// On 2026-03-01 Rahima is still in probation, Karim has no probation, and Veteran's probation ended in 2020.
const CSV = [
  'Employee Code,First Name,Last Name,Email,Department,Position,Manager,Joining Date,Probation End Date',
  'EMP-0020,Rahima,Akter,rahima@example.test,ENG,Engineer,EMP-0007,2026-01-05,2026-07-05',
  ',Karim,"Hossain, Jr.",karim@example.test,eng,engineer,EMP-0020,2026-01-06,',
  ',Dup,One,boss@example.test,ENG,Engineer,,2026-01-07,',
  ',Bad,Dept,bad@example.test,NOPE,Engineer,,2026-01-08,',
  ',Future,Hire,future@example.test,ENG,Engineer,,2026-03-02,',
  ',Veteran,Staff,veteran@example.test,ENG,Engineer,,2019-07-01,2020-01-01',
].join('\r\n');

describe('POST /employees/import/preview (FR-EMP-008)', () => {
  it('maps headers and reports row errors and duplicates without saving anything', async () => {
    const res = await preview({ csv: CSV });
    expect(res.status).toBe(200);
    const body = await json<Preview>(res);
    expect(body).toMatchObject({ totalRows: 6, validRows: 3, invalidRows: 3, duplicates: [3] });
    expect(body.previewToken).toMatch(/^[0-9a-f]{64}$/);
    expect(body.mapping).toMatchObject({
      Email: 'workEmail',
      Manager: 'managerCode',
      'Probation End Date': 'probationEndDate',
    });
    // A joining date after today is a new hire, not existing staff (BUSINESS-RULES §10).
    expect(body.errors.map((e) => `${e.row}${e.path}:${e.code}`)).toEqual([
      '3/workEmail:duplicate_existing',
      '4/departmentCode:not_found',
      '5/joiningDate:date_in_future',
    ]);
    const saved = await f.db
      .select()
      .from(schema.employees)
      .where(and(eq(schema.employees.companyId, f.companyId), eq(schema.employees.firstName, 'Rahima')));
    expect(saved).toHaveLength(0);
  });

  it('reports a missing required column and rejects malformed CSV', async () => {
    const body = await json<Preview>(await preview({ csv: 'First Name,Last Name\nA,B' }));
    expect(body.errors.map((e) => `${e.path}:${e.code}`)).toContain('/mapping:missing_column');
    const bad = await preview({ csv: 'First Name\n"open' });
    expect(bad.status).toBe(400);
    expect((await json<{ errors: { path: string }[] }>(bad)).errors[0]?.path).toBe('/csv');
    const tooMany = ['First Name,Last Name', ...Array.from({ length: 501 }, (_, i) => `A${i},B`)].join('\n');
    expect((await preview({ csv: tooMany })).status).toBe(400);
  });

  it('returns 403 to users without employee.manage', async () => {
    const res = await preview({ csv: CSV }, staff.cookie);
    expect(res.status).toBe(403);
  });
});

describe('POST /employees/import/commit', () => {
  it('requires an Idempotency-Key and the matching preview token', async () => {
    const noKey = await call('POST', '/api/v1/employees/import/commit', {
      cookie: hr.cookie,
      body: { csv: CSV, previewToken: '0'.repeat(64) },
    });
    expect(noKey.status).toBe(400);
    expect((await json(noKey)).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const wrong = await commit({ csv: CSV, previewToken: '0'.repeat(64) }, 'import-wrong-token');
    expect(wrong.status).toBe(400);
    expect((await json<{ errors: { path: string }[] }>(wrong)).errors[0]?.path).toBe('/previewToken');
  });

  it('creates employed staff with applied hire and confirm events, links managers, and replays', async () => {
    const token = (await json<Preview>(await preview({ csv: CSV }))).previewToken;
    const res = await commit({ csv: CSV, previewToken: token }, 'import-commit-0001');
    expect(res.status).toBe(200);
    const result = await json<Result>(res);
    expect(result).toMatchObject({ createdCount: 3, skippedCount: 3 });
    expect(result.errors.map((e) => `${e.row}:${e.code}`)).toContain('5:date_in_future');
    // The imported code EMP-0020 keeps its value; the sequence moves above it for the generated codes.
    expect(result.created.map((c) => `${c.employeeCode}:${c.status}`)).toEqual([
      'EMP-0020:probation',
      'EMP-0021:active',
      'EMP-0022:active',
    ]);

    const [rahima, karim, veteran] = await Promise.all(
      result.created.map(async (c) => {
        const [row] = await f.db.select().from(schema.employees).where(eq(schema.employees.id, c.id));
        return row;
      }),
    );
    expect(rahima).toMatchObject({
      status: 'probation',
      joiningDate: '2026-01-05',
      probationEndDate: '2026-07-05',
    });
    expect(karim).toMatchObject({
      status: 'active',
      joiningDate: '2026-01-06',
      probationEndDate: null,
      lastName: 'Hossain, Jr.',
      managerId: rahima?.id,
    });
    expect(veteran).toMatchObject({
      status: 'active',
      joiningDate: '2019-07-01',
      probationEndDate: '2020-01-01',
    });

    // Events as the hire and confirm actions record them: applied, on the historical dates.
    const events = (id: string | undefined) =>
      f.db
        .select()
        .from(schema.employmentEvents)
        .where(eq(schema.employmentEvents.employeeId, id as string))
        .orderBy(asc(schema.employmentEvents.effectiveDate));
    expect((await events(rahima?.id)).map((e) => [e.type, e.effectiveDate, e.status, e.changes])).toEqual([
      [
        'hired',
        '2026-01-05',
        'applied',
        {
          status: { from: 'preboarding', to: 'probation' },
          joiningDate: { from: null, to: '2026-01-05' },
          probationEndDate: { from: null, to: '2026-07-05' },
        },
      ],
    ]);
    expect((await events(karim?.id)).map((e) => `${e.type}@${e.effectiveDate}:${e.status}`)).toEqual([
      'hired@2026-01-06:applied',
    ]);
    const veteranEvents = await events(veteran?.id);
    expect(veteranEvents.map((e) => `${e.type}@${e.effectiveDate}:${e.status}`)).toEqual([
      'hired@2019-07-01:applied',
      'confirmed@2020-01-01:applied',
    ]);
    expect(veteranEvents.every((e) => e.appliedAt !== null && e.createdBy === hr.userId)).toBe(true);

    // Audit: per event the rows the lifecycle actions write, plus one summary row for the import.
    const audit = await f.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.employeeId, veteran?.id as string));
    // Rows written in one statement share a millisecond, so their ids do not sort in a fixed order.
    expect(audit).toHaveLength(4);
    expect(audit.map((a) => [a.action, a.metadata])).toEqual(
      expect.arrayContaining([
        ['employment_event.created', { type: 'hired', effectiveDate: '2019-07-01', status: 'applied' }],
        ['employee.status_changed', { from: 'preboarding', to: 'probation', effectiveDate: '2019-07-01' }],
        ['employment_event.created', { type: 'confirmed', effectiveDate: '2020-01-01', status: 'applied' }],
        ['employee.status_changed', { from: 'probation', to: 'active', effectiveDate: '2020-01-01' }],
      ]),
    );
    expect(
      audit
        .filter((a) => a.action === 'employment_event.created')
        .map((a) => a.entityId)
        .sort(),
    ).toEqual(veteranEvents.map((e) => e.id).sort());
    const summary = await f.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(eq(schema.auditLogs.companyId, f.companyId), eq(schema.auditLogs.action, 'employee.imported')),
      );
    expect(summary).toHaveLength(1);
    expect(summary[0]?.metadata).toMatchObject({
      createdCount: 3,
      skippedCount: 3,
      byStatus: { active: 2, probation: 1 },
    });

    const replay = await commit({ csv: CSV, previewToken: token }, 'import-commit-0001');
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect((await json<Result>(replay)).created).toEqual(result.created);

    // A fresh key re-validates: the same rows are now duplicates of existing employees.
    const again = await json<Result>(await commit({ csv: CSV, previewToken: token }, 'import-commit-0002'));
    expect(again.createdCount).toBe(0);

    const next = await call('POST', '/api/v1/employees', {
      cookie: hr.cookie,
      body: {
        firstName: 'After',
        lastName: 'Import',
        joiningDate: '2026-02-01',
        departmentId: rahima?.departmentId,
        positionId: rahima?.positionId,
      },
    });
    expect((await json<{ employeeCode: string }>(next)).employeeCode).toBe('EMP-0023');
  });

  it('rejects a joining date after today per row and imports the others', async () => {
    const csv = [
      'First Name,Last Name,Joining Date,Department,Position',
      'Starts,Tomorrow,2026-03-02,ENG,Engineer',
      'Started,Today,2026-03-01,ENG,Engineer',
    ].join('\n');
    const token = (await json<Preview>(await preview({ csv }))).previewToken;
    const result = await json<Result>(await commit({ csv, previewToken: token }, 'import-future-0001'));
    expect(result.errors.map((e) => `${e.row}:${e.code}`)).toEqual(['1:date_in_future']);
    expect(result.created.map((c) => `${c.row}:${c.status}`)).toEqual(['2:active']);
  });

  it('grants no leave; the daily eligibility step grants imported staff (BUSINESS-RULES 5.1)', async () => {
    const imported = await f.db
      .select({ id: schema.employees.id })
      .from(schema.employees)
      .where(
        and(
          eq(schema.employees.companyId, f.companyId),
          inArray(schema.employees.firstName, ['Rahima', 'Karim', 'Veteran']),
        ),
      );
    const ids = imported.map((e) => e.id);
    expect(ids).toHaveLength(3);
    const ledger = () =>
      f.db
        .select({ employeeId: schema.leaveLedgerEntries.employeeId, type: schema.leaveLedgerEntries.type })
        .from(schema.leaveLedgerEntries)
        .where(inArray(schema.leaveLedgerEntries.employeeId, ids));
    expect(await ledger()).toEqual([]);

    const at = zonedInstant('2026-03-01', '00:05');
    const deps = createDeps(env, fixedClock(at), {
      requestId: 'test-import-grants',
      ipAddress: null,
      userAgent: null,
    });
    const today = toBusinessDate(at);
    const ctx = { deps, companyId: f.companyId, today, yesterday: addDays(today, -1) };
    try {
      const outcome = await runJob(
        deps,
        f.companyId,
        leaveEligibilityGrantsStep.job,
        leaveEligibilityGrantsStep.runKey(ctx),
        (tx) => leaveEligibilityGrantsStep.run(tx, ctx),
      );
      expect(outcome).toBe('succeeded');
    } finally {
      await deps.close();
    }
    const grants = await ledger();
    for (const id of ids) {
      const own = grants.filter((g) => g.employeeId === id);
      expect(own.length).toBeGreaterThan(0);
      expect(own.every((g) => g.type === 'grant')).toBe(true);
    }
  });

  it('returns 403 to users without employee.manage', async () => {
    const res = await commit({ csv: CSV, previewToken: '0'.repeat(64) }, 'import-staff-0001', staff.cookie);
    expect(res.status).toBe(403);
  });
});
