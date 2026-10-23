import { type Auth, createAuth } from '@hrm/auth';
import { createDb, type Db, schema, uuidv7 } from '@hrm/db';
import { type Mailer, renderEmail } from '@hrm/mailer';
import { and, eq, lt } from 'drizzle-orm';
import { recordAudit } from './audit';
import type { Clock } from './clock';
import { selectMailer } from './mailer';

export interface RequestMeta {
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Per-request dependencies (CODING-STANDARDS §11: one DB client per request from the Hyperdrive binding). */
export interface Deps {
  env: Env;
  db: Db;
  clock: Clock;
  mailer: Mailer;
  meta: RequestMeta;
  /** Better Auth, created on first use. */
  auth(): Auth;
  /** Work to finish after the response (after-commit email sends); the DB closes once it settles. */
  defer(work: Promise<unknown>): void;
  /** Waits for deferred work, then closes the database connection. */
  close(): Promise<void>;
}

export function createDeps(
  env: Env,
  clock: Clock,
  meta: RequestMeta,
  extraAuthPlugins: Parameters<typeof createAuth>[0]['extraPlugins'] = [],
): Deps {
  const { db, sql } = createDb(env.HYPERDRIVE.connectionString);
  const mailer = selectMailer(env);
  const pending: Promise<unknown>[] = [];
  let auth: Auth | null = null;

  const deps: Deps = {
    env,
    db,
    clock,
    mailer,
    meta,
    auth() {
      auth ??= createAuth({
        db,
        schema,
        secret: env.BETTER_AUTH_SECRET,
        baseURL: env.APP_ORIGIN,
        extraPlugins: extraAuthPlugins,
        // EMAIL.md §4: inline, only for active users; failures are logged, never revealed (no enumeration).
        sendSignInCode: async ({ email, otp }) => {
          const [user] = await db
            .select({ status: schema.users.status })
            .from(schema.users)
            .where(eq(schema.users.email, email));
          if (user?.status !== 'active') return;
          const message = renderEmail('sign_in_code', { code: otp });
          try {
            const result = await mailer.send({ to: email, ...message });
            await db.insert(schema.emailDeliveries).values({
              id: uuidv7(),
              template: 'sign_in_code',
              toAddress: email,
              providerMessageId: result.providerMessageId,
              status: 'sent',
            });
          } catch (err) {
            const error = err instanceof Error ? err.message.slice(0, 500) : 'unknown error';
            await db
              .insert(schema.emailDeliveries)
              .values({ id: uuidv7(), template: 'sign_in_code', toAddress: email, status: 'failed', error });
            console.error(
              JSON.stringify({ level: 'error', requestId: meta.requestId, msg: 'sign-in code email failed' }),
            );
          }
        },
        canSignIn: async (userId) => {
          const [user] = await db
            .select({ status: schema.users.status })
            .from(schema.users)
            .where(eq(schema.users.id, userId));
          return user?.status === 'active';
        },
        onSignedIn: async ({ userId, method, strong }) => {
          const [user] = await db
            .update(schema.users)
            .set({ lastLoginAt: clock.now() })
            .where(and(eq(schema.users.id, userId), eq(schema.users.status, 'active')))
            .returning({ companyId: schema.users.companyId });
          if (!user) return;
          await recordAudit(
            db,
            { companyId: user.companyId, userId, type: 'user', ...meta },
            {
              action: 'user.signed_in',
              category: 'security',
              entityType: 'user',
              entityId: userId,
              metadata: { method, strong },
            },
          );
        },
      });
      return auth;
    },
    defer(work) {
      pending.push(
        work.catch((err) =>
          console.error(JSON.stringify({ level: 'error', requestId: meta.requestId, msg: String(err) })),
        ),
      );
    },
    async close() {
      await Promise.allSettled(pending);
      await sql.end({ timeout: 5 });
    },
  };
  return deps;
}

/** Touches a session's activity time (idle timeout, AUTH-IMPLEMENTATION §3.1). */
export async function touchSession(db: Db, sessionId: string, now: Date) {
  await db
    .update(schema.sessions)
    .set({ updatedAt: now })
    // lt() encodes the Date through the column type; a raw template would send Date.toString(), which Postgres rejects.
    .where(and(eq(schema.sessions.id, sessionId), lt(schema.sessions.updatedAt, now)));
}
