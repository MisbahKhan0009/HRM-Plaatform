import { env, exports } from 'cloudflare:workers';
import { type AssignableRoleCode, DEFAULT_ROLES } from '@hrm/contracts';
import { createDb, type Db, schema, seedCompany, uuidv7 } from '@hrm/db';
import { and, eq, inArray } from 'drizzle-orm';

export const ORIGIN = 'https://hrm.test';

/** A direct database client for fixtures and assertions (same database the Worker uses). */
export function testDb(): Db {
  return createDb(env.HYPERDRIVE.connectionString).db;
}

export interface TestUser {
  userId: string;
  email: string;
  employeeId: string | null;
  cookie: string;
}

export interface Fixture {
  db: Db;
  companyId: string;
  /** Creates an active user, optionally with explicit roles and a linked employee. */
  user(options?: UserOptions): Promise<{ userId: string; email: string; employeeId: string | null }>;
  /** Creates a user and signs in (strong session by default, as privileged roles need it). */
  signIn(options?: UserOptions & { strong?: boolean }): Promise<TestUser>;
  employee(options?: EmployeeOptions): Promise<string>;
}

export interface UserOptions {
  roles?: AssignableRoleCode[];
  status?: 'invited' | 'active' | 'suspended' | 'deactivated';
  /** Link an employee record (gives the derived `employee` role). */
  employee?: boolean | EmployeeOptions;
  name?: string;
}

export interface EmployeeOptions {
  managerId?: string | null;
  status?: 'draft' | 'preboarding' | 'probation' | 'active' | 'notice_period' | 'separated' | 'archived';
  firstName?: string;
  lastName?: string;
  userId?: string | null;
  departmentId?: string | null;
  joiningDate?: string;
}

let counter = 0;
const unique = () =>
  `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Creates an isolated company with the default roles and settings (each test file calls this once). */
export async function setupCompany(name = 'Test Co'): Promise<Fixture> {
  const db = testDb();
  const { companyId } = await seedCompany(db, { companyId: uuidv7(), companyName: name, policyYear: 2026 });
  const roleIds = new Map(
    (
      await db
        .select({ id: schema.roles.id, code: schema.roles.code })
        .from(schema.roles)
        .where(eq(schema.roles.companyId, companyId))
    ).map((r) => [r.code, r.id]),
  );

  const fixture: Fixture = {
    db,
    companyId,
    async employee(o = {}) {
      const id = uuidv7();
      const code = unique().toUpperCase();
      await db.insert(schema.employees).values({
        id,
        companyId,
        employeeCode: `T-${code}`,
        firstName: o.firstName ?? 'Test',
        lastName: o.lastName ?? `Person ${code}`,
        status: o.status ?? 'active',
        managerId: o.managerId ?? null,
        userId: o.userId ?? null,
        departmentId: o.departmentId ?? null,
        joiningDate:
          o.joiningDate ?? (o.status === 'draft' || o.status === 'preboarding' ? null : '2025-01-01'),
      });
      return id;
    },
    async user(o = {}) {
      const userId = uuidv7();
      const email = `u-${unique()}@example.test`;
      await db.insert(schema.users).values({
        id: userId,
        companyId,
        email,
        name: o.name ?? 'Test User',
        emailVerified: true,
        status: o.status ?? 'active',
      });
      const roles = (o.roles ?? []).map((r) => roleIds.get(r)).filter((id): id is string => Boolean(id));
      if (roles.length) await db.insert(schema.userRoles).values(roles.map((roleId) => ({ userId, roleId })));
      let employeeId: string | null = null;
      if (o.employee)
        employeeId = await fixture.employee({ ...(o.employee === true ? {} : o.employee), userId });
      return { userId, email, employeeId };
    },
    async signIn(o = {}) {
      const u = await fixture.user(o);
      const cookie = await login(u.userId, o.strong ?? true);
      return { ...u, cookie };
    },
  };
  return fixture;
}

/** Signs in through the test-only route and returns the Cookie header value. */
export async function login(userId: string, strong = true): Promise<string> {
  const res = await call('POST', '/api/v1/__test/login', { body: { userId, strong } });
  if (res.status !== 200) throw new Error(`test login failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { cookie: string }).cookie;
}

export interface CallOptions {
  body?: unknown;
  cookie?: string;
  headers?: Record<string, string>;
  /** Fixes the server clock (APP_ENV=test only). */
  now?: string;
}

/** Calls the Worker like a browser on the app origin would. */
export function call(method: string, path: string, o: CallOptions = {}) {
  const headers = new Headers({ Origin: ORIGIN, ...o.headers });
  if (o.cookie) headers.set('Cookie', o.cookie);
  if (o.now) headers.set('X-Test-Now', o.now);
  if (o.body !== undefined) headers.set('Content-Type', 'application/json');
  return exports.default.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers,
      ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
    }),
  );
}

export const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;

/** Audit rows for an entity, oldest first. */
export async function auditFor(db: Db, entityId: string) {
  return db
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.entityId, entityId))
    .orderBy(schema.auditLogs.occurredAt);
}

export async function outboxFor(db: Db, companyId: string, topics: string[]) {
  return db
    .select()
    .from(schema.outboxMessages)
    .where(and(eq(schema.outboxMessages.companyId, companyId), inArray(schema.outboxMessages.topic, topics)));
}

/** Polls until `check` returns a truthy value (after-commit work runs in waitUntil). */
export async function eventually<T>(
  check: () => Promise<T | undefined | null | false>,
  timeoutMs = 3000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 50));
  }
}

export const PRIVILEGED_ROLES = DEFAULT_ROLES.filter((r) => r.requiresStrongAuth).map((r) => r.code);
