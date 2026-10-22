import { type Queryable, schema, uuidv7 } from '@hrm/db';
import { MailerError } from '@hrm/mailer';
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { buildEmail, type EmailTopic, type TopicPayload } from '../notifications/topics';
import { recordAudit } from './audit';
import { type Actor, systemActor } from './auth-context';
import type { Deps } from './deps';

const { outboxMessages, emailDeliveries } = schema;

export interface OutboxMessage<T extends EmailTopic = EmailTopic> {
  topic: T;
  payload: TopicPayload<T>;
  /** Prevents a second message when a command is retried, e.g. `leave_request.approved:<id>`. */
  dedupeKey?: string;
}

/**
 * Queues a side effect in the caller's transaction (JOBS-AND-OUTBOX §2.1): the message commits or rolls back with
 * the business change. Returns the new ids for the after-commit send (empty when deduplicated).
 */
export async function enqueue(tx: Queryable, actor: Actor, ...messages: OutboxMessage[]): Promise<string[]> {
  if (!messages.length) return [];
  const rows = await tx
    .insert(outboxMessages)
    .values(
      messages.map((m) => ({
        id: uuidv7(),
        companyId: actor.companyId,
        topic: m.topic,
        payload: m.payload as Record<string, unknown>,
        dedupeKey: m.dedupeKey ?? null,
      })),
    )
    .onConflictDoNothing({
      target: [outboxMessages.companyId, outboxMessages.dedupeKey],
      where: sql`${outboxMessages.dedupeKey} IS NOT NULL`,
    })
    .returning({ id: outboxMessages.id });
  return rows.map((r) => r.id);
}

const BACKOFF_MINUTES = [1, 5, 15, 30, 60, 120, 240];
export const MAX_ATTEMPTS = 8;
const BATCH = 20;

/**
 * Claims and sends outbox messages (JOBS-AND-OUTBOX §2.3). Safe to run concurrently: the `locked_until` claim gives
 * each message to one caller. Sending happens outside any transaction.
 */
export async function processOutbox(
  deps: Deps,
  ids: readonly string[],
): Promise<{ sent: number; failed: number }> {
  if (!ids.length) return { sent: 0, failed: 0 };
  const now = deps.clock.now();
  const claimed = await deps.db
    .update(outboxMessages)
    .set({
      status: 'processing',
      lockedUntil: new Date(now.getTime() + 2 * 60_000),
      attempts: sql`${outboxMessages.attempts} + 1`,
    })
    .where(
      and(
        inArray(outboxMessages.id, [...ids].slice(0, BATCH)),
        inArray(outboxMessages.status, ['pending', 'failed']),
        or(isNull(outboxMessages.lockedUntil), lt(outboxMessages.lockedUntil, now)),
      ),
    )
    .returning();

  let sent = 0;
  let failed = 0;
  for (const msg of claimed) {
    let to: string | null = null;
    let template: string = msg.topic.replace(/^email\./, '');
    try {
      const email = await buildEmail(deps, msg.companyId, msg.topic as EmailTopic, msg.payload as never);
      if (email) {
        to = email.to;
        template = email.template;
        const result = await deps.mailer.send(email);
        await deps.db.insert(emailDeliveries).values({
          id: uuidv7(),
          outboxMessageId: msg.id,
          template,
          toAddress: email.to,
          providerMessageId: result.providerMessageId,
          status: 'sent',
        });
      }
      await deps.db
        .update(outboxMessages)
        .set({
          status: 'sent',
          processedAt: deps.clock.now(),
          lockedUntil: null,
          lastError: null,
          payload: scrub(msg.payload),
        })
        .where(eq(outboxMessages.id, msg.id));
      sent += 1;
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message.slice(0, 500) : 'unknown error';
      if (to) {
        await deps.db.insert(emailDeliveries).values({
          id: uuidv7(),
          outboxMessageId: msg.id,
          template,
          toAddress: to,
          status: 'failed',
          error: message,
        });
      }
      const permanent = err instanceof MailerError && !err.retryable;
      const dead = permanent || msg.attempts >= MAX_ATTEMPTS;
      const delay = BACKOFF_MINUTES[Math.min(msg.attempts, BACKOFF_MINUTES.length) - 1] ?? 240;
      await deps.db.transaction(async (tx) => {
        await tx
          .update(outboxMessages)
          .set({
            status: dead ? 'dead' : 'failed',
            lockedUntil: null,
            lastError: message,
            nextAttemptAt: new Date(deps.clock.now().getTime() + delay * 60_000),
            ...(dead ? { payload: scrub(msg.payload) } : {}),
          })
          .where(eq(outboxMessages.id, msg.id));
        if (dead) {
          await recordAudit(tx, systemActor(msg.companyId), {
            action: 'outbox.message_dead',
            category: 'technical',
            entityType: 'outbox_message',
            entityId: msg.id,
            metadata: { topic: msg.topic, attempts: msg.attempts },
          });
        }
      });
    }
  }
  return { sent, failed };
}

/** Removes sealed secrets once a message is final. */
function scrub(payload: unknown) {
  if (!payload || typeof payload !== 'object') return payload as Record<string, unknown>;
  const { sealedToken: _drop, ...rest } = payload as Record<string, unknown>;
  return rest;
}

/** The retry cron's query (JOBS-AND-OUTBOX §2.4): due pending or failed messages, oldest first. */
export async function dueOutboxIds(db: Queryable, now: Date, limit = BATCH): Promise<string[]> {
  const rows = await db
    .select({ id: outboxMessages.id })
    .from(outboxMessages)
    .where(and(inArray(outboxMessages.status, ['pending', 'failed']), lt(outboxMessages.nextAttemptAt, now)))
    .orderBy(outboxMessages.nextAttemptAt)
    .limit(limit);
  return rows.map((r) => r.id);
}
