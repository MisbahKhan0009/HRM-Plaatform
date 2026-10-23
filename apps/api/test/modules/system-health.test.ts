import { schema, type Tx, uuidv7 } from '@hrm/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DailyStep } from '../../src/jobs/dispatcher';
import { DAILY_STEPS } from '../../src/jobs/steps';
import { call, eventually, type Fixture, json, setupCompany, type TestUser } from '../harness';

let f: Fixture;
let admin: TestUser;
let hr: TestUser;
let other: Fixture;

beforeAll(async () => {
  f = await setupCompany('Health Co');
  admin = await f.signIn({ roles: ['system_admin'] });
  hr = await f.signIn({ roles: ['hr_admin'] });
  other = await setupCompany('Other Health Co');
});

describe('GET /health/details', () => {
  it('reports database latency, jobs, outbox backlog and emails for system.health.read', async () => {
    const old = new Date(Date.now() - 3_600_000);
    await f.db.insert(schema.outboxMessages).values([
      { id: uuidv7(), companyId: f.companyId, topic: 'email.auth_reset', payload: {}, createdAt: old },
      { id: uuidv7(), companyId: f.companyId, topic: 'email.auth_reset', payload: {}, status: 'dead' },
      { id: uuidv7(), companyId: other.companyId, topic: 'email.auth_reset', payload: {}, status: 'dead' },
    ]);
    const res = await call('GET', '/api/v1/health/details', { cookie: admin.cookie });
    expect(res.status).toBe(200);
    const body = await json<{
      database: { ok: boolean; latencyMs: number };
      jobs: unknown[];
      outbox: { counts: Record<string, number>; oldestPendingAgeSeconds: number | null };
      emailsToday: { sent: number; failed: number };
    }>(res);
    expect(body.database.ok).toBe(true);
    expect(body.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.outbox.counts).toMatchObject({ pending: 1, dead: 1 });
    expect(body.outbox.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(3590);
    expect(Array.isArray(body.jobs)).toBe(true);
    expect(body.emailsToday).toEqual({ sent: expect.any(Number), failed: expect.any(Number) });
  });

  it('is not public, and needs system.health.read', async () => {
    expect((await call('GET', '/api/v1/health/details')).status).toBe(401);
    expect((await call('GET', '/api/v1/health/details', { cookie: hr.cookie })).status).toBe(403);
    expect((await call('GET', '/api/v1/health')).status).toBe(200);
  });
});

describe('POST /admin/jobs/{job}/run', () => {
  it('runs maintenance.prune: retention deletes and yesterday’s audit counts', async () => {
    const now = Date.now();
    const userId = admin.userId;
    await f.db.insert(schema.idempotencyRecords).values({
      id: uuidv7(),
      userId,
      idempotencyKey: `expired-${uuidv7()}`,
      operation: 'test',
      requestHash: 'x',
      status: 'completed',
      expiresAt: new Date(now - 60_000),
    });
    const staleKey = `api:test-${uuidv7()}`;
    await f.db
      .insert(schema.rateLimits)
      .values({ id: uuidv7(), key: staleKey, count: 1, lastRequest: now - 2 * 86_400_000 });
    await f.db.insert(schema.auditLogs).values([
      {
        id: uuidv7(),
        companyId: f.companyId,
        occurredAt: new Date('2026-05-31T12:00:00+06:00'),
        actorType: 'system',
        action: 'job.failed',
        category: 'technical',
        entityType: 'job_run',
      },
      {
        id: uuidv7(),
        companyId: f.companyId,
        occurredAt: new Date('2026-05-31T23:59:00+06:00'),
        actorType: 'system',
        action: 'department.created',
        category: 'business',
        entityType: 'department',
      },
    ]);

    const res = await call('POST', '/api/v1/admin/jobs/maintenance.prune/run', {
      cookie: admin.cookie,
      body: { date: '2026-06-01' },
    });
    expect(res.status).toBe(200);
    const body = await json<{
      outcome: string;
      runKey: string;
      details: { deleted: Record<string, number>; auditDate: string; auditCounts: Record<string, number> };
    }>(res);
    expect(body).toMatchObject({ outcome: 'succeeded', runKey: '2026-06-01' });
    expect(body.details.auditDate).toBe('2026-05-31');
    expect(body.details.auditCounts).toEqual({ business: 1, payroll: 0, security: 0, technical: 1 });
    expect(body.details.deleted.idempotencyRecords).toBeGreaterThanOrEqual(1);
    expect(body.details.deleted.rateLimits).toBeGreaterThanOrEqual(1);
    expect(await f.db.select().from(schema.rateLimits).where(eq(schema.rateLimits.key, staleKey))).toEqual(
      [],
    );

    const again = await call('POST', '/api/v1/admin/jobs/maintenance.prune/run', {
      cookie: admin.cookie,
      body: { date: '2026-06-01' },
    });
    expect((await json(again)).outcome).toBe('skipped');
    const requested = await f.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(eq(schema.auditLogs.companyId, f.companyId), eq(schema.auditLogs.action, 'job.run_requested')),
      );
    expect(requested.length).toBeGreaterThanOrEqual(2);
    expect(requested[0]?.category).toBe('technical');
  });

  it('records a failing step as failed with job.failed, and accepts an explicit runKey', async () => {
    const failing: DailyStep = {
      job: 'test.always_fails',
      runsOn: () => true,
      runKey: (ctx) => ctx.today,
      run: async (_tx: Tx) => {
        throw new Error('boom');
      },
    };
    const steps = DAILY_STEPS as DailyStep[];
    steps.push(failing);
    try {
      const res = await call('POST', '/api/v1/admin/jobs/test.always_fails/run', {
        cookie: admin.cookie,
        body: { runKey: 'manual-1' },
      });
      expect(res.status).toBe(200);
      expect(await json(res)).toMatchObject({ outcome: 'failed', runKey: 'manual-1', error: 'boom' });
      const failed = await f.db
        .select()
        .from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.companyId, f.companyId), eq(schema.auditLogs.action, 'job.failed')));
      expect(failed.some((a) => (a.metadata as { job: string }).job === 'test.always_fails')).toBe(true);
    } finally {
      steps.splice(steps.indexOf(failing), 1);
    }
  });

  it('returns 404 for an unknown step and 400 for a bad date or job name', async () => {
    const unknown = await call('POST', '/api/v1/admin/jobs/nothing.here/run', {
      cookie: admin.cookie,
      body: {},
    });
    expect(unknown.status).toBe(404);
    const badDate = await call('POST', '/api/v1/admin/jobs/maintenance.prune/run', {
      cookie: admin.cookie,
      body: { date: '2026-13-01' },
    });
    expect(badDate.status).toBe(400);
    const badName = await call('POST', '/api/v1/admin/jobs/DROP%20TABLE/run', {
      cookie: admin.cookie,
      body: {},
    });
    expect(badName.status).toBe(400);
  });

  it('needs system.health.read and settings.technical.manage on a strong session', async () => {
    expect(
      (await call('POST', '/api/v1/admin/jobs/maintenance.prune/run', { cookie: hr.cookie, body: {} }))
        .status,
    ).toBe(403);
    const weak = await f.signIn({ roles: ['system_admin'], strong: false });
    const res = await call('POST', '/api/v1/admin/jobs/maintenance.prune/run', {
      cookie: weak.cookie,
      body: {},
    });
    expect((await json(res)).code).toBe('MFA_REQUIRED');
  });

  it('is the last daily step', () => {
    expect(DAILY_STEPS.at(-1)?.job).toBe('maintenance.prune');
  });
});

describe('GET /admin/jobs', () => {
  type Jobs = {
    data: { job: string; lastRun: { runKey: string; status: string; items: number } | null }[];
  };

  it('lists every daily step in dispatcher order with its last run for the caller’s company', async () => {
    const res = await call('GET', '/api/v1/admin/jobs', { cookie: admin.cookie });
    expect(res.status).toBe(200);
    const body = await json<Jobs>(res);
    expect(body.data.map((j) => j.job)).toEqual(DAILY_STEPS.map((s) => s.job));
    // maintenance.prune ran above for this company only.
    expect(body.data.find((j) => j.job === 'maintenance.prune')?.lastRun).toMatchObject({
      runKey: '2026-06-01',
      status: 'succeeded',
    });
    const otherAdmin = await other.signIn({ roles: ['system_admin'] });
    const theirs = await json<Jobs>(await call('GET', '/api/v1/admin/jobs', { cookie: otherAdmin.cookie }));
    expect(theirs.data.find((j) => j.job === 'maintenance.prune')?.lastRun).toBeNull();
    const audit = await f.db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.companyId, f.companyId), eq(schema.auditLogs.action, 'job.listed')));
    expect(audit[0]).toMatchObject({ category: 'technical', actorUserId: admin.userId });
  });

  it('is not public, and needs system.health.read', async () => {
    expect((await call('GET', '/api/v1/admin/jobs')).status).toBe(401);
    expect((await call('GET', '/api/v1/admin/jobs', { cookie: hr.cookie })).status).toBe(403);
  });
});

describe('POST /admin/outbox/retry', () => {
  it('makes failed messages due now, leaves dead ones and other companies alone, and sends them', async () => {
    const later = new Date(Date.now() + 3_600_000);
    const failedIds = [uuidv7(), uuidv7()];
    const deadId = uuidv7();
    const otherId = uuidv7();
    const base = { topic: 'email.auth_reset', payload: {}, attempts: 1, nextAttemptAt: later } as const;
    await f.db
      .insert(schema.outboxMessages)
      .values([
        ...failedIds.map((id) => ({ ...base, id, companyId: f.companyId, status: 'failed' as const })),
        { ...base, id: deadId, companyId: f.companyId, status: 'dead' as const },
        { ...base, id: otherId, companyId: other.companyId, status: 'failed' as const },
      ]);
    const res = await call('POST', '/api/v1/admin/outbox/retry', { cookie: admin.cookie });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ reset: 2, processing: 2 });

    const row = async (id: string) =>
      (await f.db.select().from(schema.outboxMessages).where(eq(schema.outboxMessages.id, id)))[0];
    // After commit each reset message is claimed again (one more attempt), whatever the send outcome.
    for (const id of failedIds) await eventually(async () => ((await row(id))?.attempts ?? 0) >= 2);
    expect(await row(deadId)).toMatchObject({ status: 'dead', attempts: 1 });
    expect((await row(deadId))?.nextAttemptAt.getTime()).toBe(later.getTime());
    expect(await row(otherId)).toMatchObject({ status: 'failed', attempts: 1 });
    expect((await row(otherId))?.nextAttemptAt.getTime()).toBe(later.getTime());

    const audit = await f.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.companyId, f.companyId),
          eq(schema.auditLogs.action, 'outbox.retry_requested'),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ category: 'technical', metadata: { reset: 2 } });
  });

  it('needs system.health.read and settings.technical.manage on a strong session', async () => {
    expect((await call('POST', '/api/v1/admin/outbox/retry')).status).toBe(401);
    expect((await call('POST', '/api/v1/admin/outbox/retry', { cookie: hr.cookie })).status).toBe(403);
    const weak = await f.signIn({ roles: ['system_admin'], strong: false });
    const res = await call('POST', '/api/v1/admin/outbox/retry', { cookie: weak.cookie });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('MFA_REQUIRED');
  });
});
