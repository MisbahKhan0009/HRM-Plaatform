import { env } from 'cloudflare:workers';
import { schema, uuidv7 } from '@hrm/db';
import { addDays } from '@hrm/domain';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DailyContext } from '../../src/jobs/dispatcher';
import { runJob } from '../../src/jobs/run-job';
import { DAILY_STEPS } from '../../src/jobs/steps';
import { fixedClock } from '../../src/lib/clock';
import { createDeps } from '../../src/lib/deps';
import { documentExpiryReminders } from '../../src/modules/documents/documents.jobs';
import { type Fixture, outboxFor, setupCompany } from '../harness';

// 2026-11-10 00:05 Asia/Dhaka, when the daily dispatcher runs.
const AT = new Date('2026-11-09T18:05:00Z');
const TODAY = '2026-11-10';

let f: Fixture;
let hrA: string;
let hrB: string;

async function insertDocument(
  employeeId: string | null,
  title: string,
  expiryDate: string,
  status = 'active',
) {
  await f.db.insert(schema.documents).values({
    id: uuidv7(),
    companyId: f.companyId,
    employeeId,
    category: 'identity',
    title,
    expiryDate,
    status,
    ...(status === 'deleted' ? { deletedAt: AT, deletedReason: 'Retention' } : {}),
  });
}

async function run(at: Date = AT) {
  const deps = createDeps(env, fixedClock(at), { requestId: 'test-job', ipAddress: null, userAgent: null });
  const today = addDays(TODAY, Math.round((at.getTime() - AT.getTime()) / 86_400_000));
  const ctx: DailyContext = { deps, companyId: f.companyId, today, yesterday: addDays(today, -1) };
  try {
    return await runJob(
      deps,
      f.companyId,
      documentExpiryReminders.job,
      documentExpiryReminders.runKey(ctx),
      (tx) => documentExpiryReminders.run(tx, ctx),
    );
  } finally {
    await deps.close();
  }
}

beforeAll(async () => {
  f = await setupCompany('Expiry Co');
  hrA = (await f.user({ roles: ['hr_admin'] })).userId;
  hrB = (await f.user({ roles: ['hr_admin'] })).userId;
  await f.user({ roles: ['hr_admin'], status: 'suspended' });
  await f.user({ roles: ['payroll_officer'] });
  await f.user({ employee: true });

  const anika = await f.employee({ firstName: 'Anika', lastName: 'Rahman' });
  const babul = await f.employee({ firstName: 'Babul', lastName: 'Hossain' });
  await insertDocument(anika, 'Passport', addDays(TODAY, 30));
  await insertDocument(anika, 'Work permit', TODAY);
  await insertDocument(babul, 'Driving licence', addDays(TODAY, 14));
  await insertDocument(babul, 'Visa (not in a window)', addDays(TODAY, 10));
  await insertDocument(babul, 'Deleted visa', addDays(TODAY, 7), 'deleted');
  await insertDocument(null, 'Trade licence', addDays(TODAY, 7));
  await f.db.insert(schema.employmentContracts).values({
    id: uuidv7(),
    companyId: f.companyId,
    employeeId: babul,
    type: 'fixed_term',
    startDate: '2025-11-17',
    endDate: addDays(TODAY, 7),
    status: 'active',
  });
});

describe('documents.expiry_reminders', () => {
  it('is registered as a daily step', () => {
    expect(DAILY_STEPS.map((s) => s.job)).toContain('documents.expiry_reminders');
  });

  it('queues one digest per active document.manage holder listing items at 30, 14, 7 and 0 days', async () => {
    expect(await run()).toBe('succeeded');
    const messages = await outboxFor(f.db, f.companyId, ['email.document_expiry_digest']);
    const recipients = messages.map((m) => (m.payload as { recipientUserId: string }).recipientUserId).sort();
    expect(recipients).toEqual([hrA, hrB].sort());
    const payload = messages[0]?.payload as {
      items: { title: string; daysLeft: number; employeeName: string }[];
    };
    const items = payload.items;
    expect(items.map((i) => [i.title, i.daysLeft])).toEqual([
      ['Work permit', 0],
      ['Employment contract (fixed term)', 7],
      ['Trade licence', 7],
      ['Driving licence', 14],
      ['Passport', 30],
    ]);
    expect(items.find((i) => i.title === 'Trade licence')?.employeeName).toBe('Company');
    expect(items.find((i) => i.title === 'Passport')?.employeeName).toBe('Anika Rahman');
    const [jobRun] = await f.db
      .select()
      .from(schema.jobRuns)
      .where(
        and(eq(schema.jobRuns.companyId, f.companyId), eq(schema.jobRuns.job, 'documents.expiry_reminders')),
      );
    expect(jobRun).toMatchObject({ status: 'succeeded', runKey: TODAY, items: 5 });
  });

  it('does not send again for the same day', async () => {
    expect(await run()).toBe('skipped');
    expect(await outboxFor(f.db, f.companyId, ['email.document_expiry_digest'])).toHaveLength(2);
  });

  it('sends nothing on a day with no item in a window', async () => {
    expect(await run(new Date(AT.getTime() + 86_400_000))).toBe('succeeded');
    expect(await outboxFor(f.db, f.companyId, ['email.document_expiry_digest'])).toHaveLength(2);
  });
});
