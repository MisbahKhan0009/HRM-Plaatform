import { schema } from '@hrm/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { call, type Fixture, json, setupCompany, type TestUser } from '../harness';

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
  created: { row: number; id: string; employeeCode: string }[];
  errors: { row: number; code: string }[];
};

let f: Fixture;
let hr: TestUser;
let staff: TestUser;

const commit = (body: Record<string, unknown>, key: string, cookie = hr.cookie) =>
  call('POST', '/api/v1/employees/import/commit', { cookie, body, headers: { 'Idempotency-Key': key } });

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

const CSV = [
  'Employee Code,First Name,Last Name,Email,Department,Position,Manager,Joining Date',
  'EMP-0020,Rahima,Akter,rahima@example.test,ENG,Engineer,EMP-0007,2026-01-05',
  ',Karim,"Hossain, Jr.",karim@example.test,eng,engineer,EMP-0020,2026-01-06',
  ',Dup,One,boss@example.test,ENG,Engineer,,2026-01-07',
  ',Bad,Dept,bad@example.test,NOPE,Engineer,,2026-01-08',
].join('\r\n');

describe('POST /employees/import/preview (FR-EMP-008)', () => {
  it('maps headers and reports row errors and duplicates without saving anything', async () => {
    const res = await call('POST', '/api/v1/employees/import/preview', {
      cookie: hr.cookie,
      body: { csv: CSV },
    });
    expect(res.status).toBe(200);
    const preview = await json<Preview>(res);
    expect(preview).toMatchObject({ totalRows: 4, validRows: 2, invalidRows: 2, duplicates: [3] });
    expect(preview.previewToken).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.mapping).toMatchObject({ Email: 'workEmail', Manager: 'managerCode' });
    expect(preview.errors.map((e) => `${e.row}${e.path}:${e.code}`)).toEqual([
      '3/workEmail:duplicate_existing',
      '4/departmentCode:not_found',
    ]);
    const saved = await f.db
      .select()
      .from(schema.employees)
      .where(and(eq(schema.employees.companyId, f.companyId), eq(schema.employees.firstName, 'Rahima')));
    expect(saved).toHaveLength(0);
  });

  it('reports a missing required column and rejects malformed CSV', async () => {
    const res = await call('POST', '/api/v1/employees/import/preview', {
      cookie: hr.cookie,
      body: { csv: 'First Name,Last Name\nA,B' },
    });
    const preview = await json<Preview>(res);
    expect(preview.errors.map((e) => e.code)).toContain('missing_column');
    const bad = await call('POST', '/api/v1/employees/import/preview', {
      cookie: hr.cookie,
      body: { csv: 'First Name\n"open' },
    });
    expect(bad.status).toBe(400);
    expect((await json<{ errors: { path: string }[] }>(bad)).errors[0]?.path).toBe('/csv');
    const tooMany = ['First Name,Last Name', ...Array.from({ length: 501 }, (_, i) => `A${i},B`)].join('\n');
    expect(
      (await call('POST', '/api/v1/employees/import/preview', { cookie: hr.cookie, body: { csv: tooMany } }))
        .status,
    ).toBe(400);
  });

  it('returns 403 to users without employee.manage', async () => {
    const res = await call('POST', '/api/v1/employees/import/preview', {
      cookie: staff.cookie,
      body: { csv: CSV },
    });
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

  it('creates the valid rows in draft with codes, links managers, and replays on retry', async () => {
    const preview = await json<Preview>(
      await call('POST', '/api/v1/employees/import/preview', { cookie: hr.cookie, body: { csv: CSV } }),
    );
    const res = await commit({ csv: CSV, previewToken: preview.previewToken }, 'import-commit-0001');
    expect(res.status).toBe(200);
    const result = await json<Result>(res);
    expect(result).toMatchObject({ createdCount: 2, skippedCount: 2 });
    // The imported code EMP-0020 keeps its value; the sequence moves above it for the generated code.
    expect(result.created.map((c) => c.employeeCode)).toEqual(['EMP-0020', 'EMP-0021']);

    const [rahima, karim] = await Promise.all(
      result.created.map(async (c) => {
        const [row] = await f.db.select().from(schema.employees).where(eq(schema.employees.id, c.id));
        return row;
      }),
    );
    expect(rahima).toMatchObject({ status: 'draft', joiningDate: '2026-01-05' });
    expect(karim).toMatchObject({ lastName: 'Hossain, Jr.', managerId: rahima?.id });

    const replay = await commit({ csv: CSV, previewToken: preview.previewToken }, 'import-commit-0001');
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect((await json<Result>(replay)).created).toEqual(result.created);

    const audit = await f.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(eq(schema.auditLogs.companyId, f.companyId), eq(schema.auditLogs.action, 'employee.imported')),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.metadata).toMatchObject({ createdCount: 2, skippedCount: 2 });

    // A fresh key re-validates: the same rows are now duplicates of existing employees.
    const again = await json<Result>(
      await commit({ csv: CSV, previewToken: preview.previewToken }, 'import-commit-0002'),
    );
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
    expect((await json<{ employeeCode: string }>(next)).employeeCode).toBe('EMP-0022');
  });

  it('returns 403 to users without employee.manage', async () => {
    const res = await commit({ csv: CSV, previewToken: '0'.repeat(64) }, 'import-staff-0001', staff.cookie);
    expect(res.status).toBe(403);
  });
});
