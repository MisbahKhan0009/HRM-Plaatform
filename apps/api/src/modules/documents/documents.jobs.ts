import type { DailyStep } from '../../jobs/dispatcher';
import { systemActor } from '../../lib/auth-context';
import { enqueue } from '../../lib/outbox';
import * as repo from './documents.repository';

/**
 * `documents.expiry_reminders` (JOBS-AND-OUTBOX §3, FR-DOC-006, US-DOC-004): one digest email per active user who
 * holds `document.manage`, listing documents and contracts that expire in 30, 14, 7 or 0 days. Idempotent twice
 * over: `job_runs` runs it once per date, and the outbox dedupe key stops a second email for the same user and date.
 */
export const documentExpiryReminders: DailyStep = {
  job: 'documents.expiry_reminders',
  runsOn: () => true,
  runKey: (ctx) => ctx.today,
  async run(tx, ctx) {
    const items = await repo.expiringItems(tx, ctx.companyId, ctx.today);
    if (!items.length) return { items: 0 };
    const recipients = await repo.documentManagers(tx, ctx.companyId);
    const digest = items.map((i) => ({
      employeeName: i.employee_name,
      title: i.title,
      expiresOn: i.expires_on,
      daysLeft: Number(i.days_left),
    }));
    const outboxIds = await enqueue(
      tx,
      systemActor(ctx.companyId),
      ...recipients.map((userId) => ({
        topic: 'email.document_expiry_digest' as const,
        payload: { recipientUserId: userId, items: digest },
        dedupeKey: `document_expiry_digest:${ctx.today}:${userId}`,
      })),
    );
    return { items: items.length, details: { recipients: recipients.length }, outboxIds };
  },
};
