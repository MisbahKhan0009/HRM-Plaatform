import { schema, uuidv7 } from '@hrm/db';
import { and, eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types';
import { sha256Hex } from './crypto';
import { problemResponse } from './problem';

const TTL_MS = 24 * 60 * 60 * 1000;
const { idempotencyRecords: records } = schema;

/**
 * Idempotency-Key handling for commands with money or ledger effects (API-STANDARDS §9). Records are scoped to
 * user + operation and kept 24 h. Responses with status >= 500 are not stored, so the client can retry.
 * Runs after the session middleware, before the handler.
 */
export const idempotent = (operation: string) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const key = c.req.header('Idempotency-Key');
    if (!key || key.length < 8 || key.length > 100) {
      return problemResponse(c, 'IDEMPOTENCY_KEY_REQUIRED', {
        title: 'Idempotency-Key required',
        detail: 'Send an Idempotency-Key header (8 to 100 characters).',
      });
    }
    const { db, clock } = c.var.deps;
    const userId = c.var.auth.userId;
    const body = await c.req.text();
    const requestHash = await sha256Hex(`${c.req.method} ${c.req.path}\n${body}`);
    const now = clock.now();

    const where = and(
      eq(records.userId, userId),
      eq(records.idempotencyKey, key),
      eq(records.operation, operation),
    );
    let [existing] = await db.select().from(records).where(where);
    if (existing && existing.expiresAt < now) {
      await db.delete(records).where(eq(records.id, existing.id));
      existing = undefined;
    }
    if (!existing) {
      const inserted = await db
        .insert(records)
        .values({
          id: uuidv7(),
          userId,
          idempotencyKey: key,
          operation,
          requestHash,
          status: 'in_progress',
          expiresAt: new Date(now.getTime() + TTL_MS),
        })
        .onConflictDoNothing()
        .returning({ id: records.id });
      if (!inserted[0]) [existing] = await db.select().from(records).where(where);
    }
    if (existing) {
      if (existing.requestHash !== requestHash) {
        return problemResponse(c, 'IDEMPOTENCY_KEY_REUSED', {
          title: 'Idempotency key reused',
          detail: 'This key was used with a different request.',
        });
      }
      if (existing.status === 'in_progress') {
        return problemResponse(c, 'IDEMPOTENCY_IN_PROGRESS', {
          title: 'Request in progress',
          detail: 'The first request with this key is still running.',
        });
      }
      const status = existing.responseStatus ?? 200;
      return c.body(JSON.stringify(existing.responseBody), status as 200, {
        'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json',
        'Idempotent-Replayed': 'true',
      });
    }

    await next();

    if (c.res.status >= 500) {
      await db.delete(records).where(where);
      return;
    }
    const text = await c.res.clone().text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    await db
      .update(records)
      .set({ status: 'completed', responseStatus: c.res.status, responseBody: parsed })
      .where(where);
  });
