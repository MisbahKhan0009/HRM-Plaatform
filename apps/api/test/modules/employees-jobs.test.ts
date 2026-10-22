import { env } from 'cloudflare:workers';
import { schema } from '@hrm/db';
import { addDays, toBusinessDate } from '@hrm/domain';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DailyContext, DailyStep } from '../../src/jobs/dispatcher';
import { runJob } from '../../src/jobs/run-job';
import { DAILY_STEPS } from '../../src/jobs/steps';
import { fixedClock } from '../../src/lib/clock';
import { createDeps, type Deps } from '../../src/lib/deps';
import { applyAccessRevocation, applyEffectiveEvents } from '../../src/modules/employees/employees.jobs';
import { auditFor, call, type Fixture, json, setupCompany, type TestUser } from '../harness';

let f: Fixture;
let hr: TestUser;
const opened: Deps[] = [];

/** Runs one step for this test company only (the dispatcher would also touch other test files' companies). */
async function runStep(step: DailyStep, at: string, runKey?: string) {
  const deps = createDeps(env as unknown as Env, fixedClock(new Date(at)), {
    requestId: null,
    ipAddress: null,
    userAgent: null,
  });
  opened.push(deps);
  const today = toBusinessDate(new Date(at));
  const ctx: DailyContext = { deps, companyId: f.companyId, today, yesterday: addDays(today, -1) };
  return runJob(deps, f.companyId, step.job, runKey ?? step.runKey(ctx), (tx) => step.run(tx, ctx));
}

const employee = async (id: string) => {
  const [row] = await f.db.select().from(schema.employees).where(eq(schema.employees.id, id));
  return row;
};
const events = (employeeId: string) =>
  f.db.select().from(schema.employmentEvents).where(eq(schema.employmentEvents.employeeId, employeeId));

beforeAll(async () => {
  f = await setupCompany('Jobs Co');
  hr = await f.signIn({ roles: ['hr_admin'] });
}, 30_000);

afterAll(async () => {
  await Promise.all(opened.map((d) => d.close()));
});

describe('DAILY_STEPS', () => {
  it('lists the employee steps in dispatcher order (JOBS-AND-OUTBOX §3)', () => {
    const jobs = DAILY_STEPS.map((s) => s.job);
    expect(jobs.indexOf('employee.apply_effective_events')).toBeLessThan(
      jobs.indexOf('accounts.apply_access_revocation'),
    );
  });
});

describe('employee.apply_effective_events', () => {
  it('applies a scheduled transition on its date, once', async () => {
    const id = await f.employee({ status: 'probation', joiningDate: '2026-01-01' });
    const res = await call('POST', `/api/v1/employees/${id}/confirm`, {
      cookie: hr.cookie,
      body: { effectiveDate: '2030-03-01', version: 1 },
    });
    expect(res.status).toBe(200);
    expect(await runStep(applyEffectiveEvents, '2030-02-27T18:10:00Z')).toBe('succeeded');
    expect((await employee(id))?.status).toBe('probation');

    // 00:10 Dhaka on 1 March 2030 is 18:10 UTC on 28 February.
    expect(await runStep(applyEffectiveEvents, '2030-02-28T18:10:00Z')).toBe('succeeded');
    expect((await employee(id))?.status).toBe('active');
    const [event] = await events(id);
    expect(event).toMatchObject({ status: 'applied', type: 'confirmed' });
    expect(event?.appliedAt).not.toBeNull();

    // Same run key: skipped. A different key: nothing left to apply.
    expect(await runStep(applyEffectiveEvents, '2030-02-28T18:10:00Z')).toBe('skipped');
    expect(await runStep(applyEffectiveEvents, '2030-02-28T18:10:00Z', 'manual-rerun')).toBe('succeeded');
    const audit = (await auditFor(f.db, id)).map((a) => a.action);
    expect(audit.filter((a) => a === 'employee.status_changed')).toHaveLength(1);
    expect((await auditFor(f.db, event?.id as string)).map((a) => a.action)).toEqual([
      'employment_event.created',
      'employment_event.applied',
    ]);
  });

  it('applies a scheduled promotion and cancels an event that no longer fits', async () => {
    const pos = await json<{ id: string }>(
      await call('POST', '/api/v1/positions', { cookie: hr.cookie, body: { title: 'Lead' } }),
    );
    const promoted = await f.employee({ status: 'active' });
    await call('POST', `/api/v1/employees/${promoted}/employment-events`, {
      cookie: hr.cookie,
      body: { type: 'promoted', effectiveDate: '2031-01-01', positionId: pos.id },
    });
    // A status change scheduled from `active`, but the employee is separated before it applies.
    const moved = await f.employee({ status: 'active' });
    await call('POST', `/api/v1/employees/${moved}/start-notice`, {
      cookie: hr.cookie,
      body: { effectiveDate: '2031-01-01', version: 1 },
    });
    await f.db.update(schema.employees).set({ status: 'separated' }).where(eq(schema.employees.id, moved));

    expect(await runStep(applyEffectiveEvents, '2031-01-01T00:00:00Z')).toBe('succeeded');
    expect((await employee(promoted))?.positionId).toBe(pos.id);
    expect((await employee(moved))?.status).toBe('separated');
    const [cancelled] = await events(moved);
    expect(cancelled?.status).toBe('cancelled');
    expect((await auditFor(f.db, cancelled?.id as string)).map((a) => a.action)).toContain(
      'employment_event.cancelled',
    );
  });
});

describe('accounts.apply_access_revocation', () => {
  it('deactivates the login of a separated employee after the last day and revokes sessions, once', async () => {
    const leaver = await f.signIn({
      employee: { status: 'active', joiningDate: '2025-01-01' },
      strong: false,
    });
    const stayer = await f.signIn({
      employee: { status: 'active', joiningDate: '2025-01-01' },
      strong: false,
    });
    const fresh = await f.signIn({ roles: ['hr_admin'] });
    const res = await call('POST', `/api/v1/employees/${leaver.employeeId}/separate`, {
      cookie: fresh.cookie,
      body: { separationDate: '2026-01-31', separationType: 'resignation', version: 1 },
    });
    expect(res.status).toBe(200);
    expect((await call('GET', '/api/v1/me/profile', { cookie: leaver.cookie })).status).toBe(200);

    expect(await runStep(applyAccessRevocation, '2026-02-01T00:00:00Z')).toBe('succeeded');
    const [user] = await f.db.select().from(schema.users).where(eq(schema.users.id, leaver.userId));
    expect(user?.status).toBe('deactivated');
    const sessions = await f.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, leaver.userId));
    expect(sessions).toHaveLength(0);
    const [other] = await f.db.select().from(schema.users).where(eq(schema.users.id, stayer.userId));
    expect(other?.status).toBe('active');
    // The employee record is unchanged by the account change (FR-EMP-012).
    expect((await employee(leaver.employeeId as string))?.status).toBe('separated');

    expect(await runStep(applyAccessRevocation, '2026-02-01T00:00:00Z', 'manual-rerun')).toBe('succeeded');
    const audits = await f.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(eq(schema.auditLogs.entityId, leaver.userId), eq(schema.auditLogs.action, 'user.deactivated')),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorType: 'system', category: 'security' });
  });
});
