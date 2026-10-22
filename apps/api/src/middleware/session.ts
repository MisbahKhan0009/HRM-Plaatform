import type { Permission, RoleCode } from '@hrm/contracts';
import { schema } from '@hrm/db';
import { and, eq, sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { AuthContext, type AuthUser } from '../lib/auth-context';
import { touchSession } from '../lib/deps';
import { problemResponse } from '../lib/problem';
import type { AppEnv } from '../types';

const V1 = '/api/v1';
/** `/health` is public; `/health/details` is not, so it is matched exactly (API-CATALOGUE §13). */
const PUBLIC_EXACT = [`${V1}/health`];
const PUBLIC_PREFIXES = [`${V1}/openapi.json`, `${V1}/auth/invitations/`, `${V1}/__test/`];
/** Our own routes under /auth that need a session (everything else under /auth is Better Auth's). */
const OWN_AUTH = [`${V1}/auth/me`, `${V1}/auth/step-up/`];
/** Routes a privileged user may call on a weak session, to see who they are and step up (AUTH-IMPLEMENTATION §3.1). */
const WEAK_ALLOWED = [`${V1}/auth/me`, `${V1}/auth/step-up/`];
const TOUCH_AFTER_MS = 5 * 60 * 1000;

const startsWithAny = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(p));

type Row = {
  session_id: string;
  strong_auth_at: Date | string | null;
  auth_method: 'passkey' | 'email_otp' | null;
  session_created_at: Date | string;
  session_updated_at: Date | string;
  user_id: string;
  company_id: string;
  email: string;
  name: string;
  status: AuthUser['status'];
  theme: AuthUser['theme'];
  locale: AuthUser['locale'];
  employee: { id: string; employee_code: string; name: string; has_reports: boolean } | null;
  roles: { code: RoleCode; strong: boolean }[];
  permissions: Permission[];
  weak_permissions: Permission[];
  idle_hours: number | null;
  privileged_idle_hours: number | null;
};

const asDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));

/**
 * Authenticates the request and builds the AuthContext (AUTH-IMPLEMENTATION §3.1). One query reads the session row,
 * user status, employee link, effective roles (explicit + derived) and permissions, so suspension, revocation and
 * role changes apply on the next request even with the 60 s cookie cache (D-044).
 */
export async function authenticate(c: Parameters<Parameters<typeof createMiddleware<AppEnv>>[0]>[0]) {
  const deps = c.var.deps;
  const found = await deps.auth().api.getSession({ headers: c.req.raw.headers });
  if (!found) return problemResponse(c, 'UNAUTHENTICATED', { title: 'Sign in required' });

  const [row] = await deps.db.execute<Row>(sql`
    WITH s AS (
      SELECT id, user_id, strong_auth_at, auth_method, created_at, updated_at FROM sessions
      WHERE id = ${found.session.id} AND expires_at > now()
    ),
    u AS (SELECT u.id, u.company_id, u.email, u.name, u.status, u.theme, u.locale FROM users u JOIN s ON s.user_id = u.id),
    e AS (
      SELECT e.id, e.employee_code, coalesce(e.preferred_name, e.first_name) || ' ' || e.last_name AS name,
        EXISTS (SELECT 1 FROM employees r WHERE r.manager_id = e.id AND r.status NOT IN ('separated', 'archived')) AS has_reports
      FROM employees e JOIN u ON e.user_id = u.id AND e.company_id = u.company_id
    ),
    r AS (
      SELECT ro.id, ro.code, ro.requires_strong_auth FROM roles ro JOIN u ON ro.company_id = u.company_id
      WHERE ro.is_active AND (
        (NOT ro.is_derived AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = ro.id))
        OR (ro.code = 'employee' AND EXISTS (SELECT 1 FROM e))
        OR (ro.code = 'manager' AND EXISTS (SELECT 1 FROM e WHERE e.has_reports))
      )
    )
    SELECT s.id AS session_id, s.strong_auth_at, s.auth_method, s.created_at AS session_created_at,
      s.updated_at AS session_updated_at, u.id AS user_id, u.company_id, u.email, u.name, u.status, u.theme, u.locale,
      (SELECT row_to_json(e) FROM e) AS employee,
      coalesce((SELECT json_agg(json_build_object('code', r.code, 'strong', r.requires_strong_auth)) FROM r), '[]') AS roles,
      coalesce((SELECT json_agg(DISTINCT rp.permission_code) FROM role_permissions rp WHERE rp.role_id IN (SELECT id FROM r)), '[]') AS permissions,
      coalesce((SELECT json_agg(DISTINCT rp.permission_code) FROM role_permissions rp
        WHERE rp.role_id IN (SELECT id FROM r WHERE NOT requires_strong_auth)), '[]') AS weak_permissions,
      (SELECT (value #>> '{}')::int FROM settings WHERE company_id = u.company_id AND key = 'security.session_idle_hours') AS idle_hours,
      (SELECT (value #>> '{}')::int FROM settings WHERE company_id = u.company_id AND key = 'security.privileged_idle_hours') AS privileged_idle_hours
    FROM s JOIN u ON true`);
  if (!row) return problemResponse(c, 'UNAUTHENTICATED', { title: 'Sign in required' });

  if (row.status !== 'active') {
    await deps.db.delete(schema.sessions).where(eq(schema.sessions.userId, row.user_id));
    return problemResponse(c, 'ACCOUNT_SUSPENDED', { title: 'Account is not active' });
  }

  const now = deps.clock.now();
  const mfaRequired = row.roles.some((r) => r.strong);
  const idleHours = (mfaRequired ? row.privileged_idle_hours : row.idle_hours) ?? (mfaRequired ? 1 : 8);
  const lastActive = asDate(row.session_updated_at);
  if (now.getTime() - lastActive.getTime() > idleHours * 3_600_000) {
    await deps.db.delete(schema.sessions).where(and(eq(schema.sessions.id, row.session_id)));
    return problemResponse(c, 'UNAUTHENTICATED', {
      title: 'Session expired',
      detail: 'Signed out after inactivity.',
    });
  }
  if (now.getTime() - lastActive.getTime() > TOUCH_AFTER_MS)
    deps.defer(touchSession(deps.db, row.session_id, now));

  const user: AuthUser = {
    id: row.user_id,
    email: row.email,
    name: row.name,
    status: row.status,
    theme: row.theme,
    locale: row.locale,
  };
  const employee = row.employee
    ? {
        id: row.employee.id,
        employeeCode: row.employee.employee_code,
        name: row.employee.name,
        hasDirectReports: row.employee.has_reports,
      }
    : null;
  const auth = new AuthContext(
    user,
    row.company_id,
    employee,
    row.roles.map((r) => r.code),
    new Set(row.permissions),
    {
      id: row.session_id,
      authMethod: row.auth_method,
      strongAuthAt: row.strong_auth_at ? asDate(row.strong_auth_at) : null,
      createdAt: asDate(row.session_created_at),
    },
    { companyId: row.company_id, userId: row.user_id, type: 'user', ...deps.meta },
    deps.db,
    mfaRequired,
    row.weak_permissions,
  );
  c.set('auth', auth);
  return null;
}

/** Better Auth routes that change sign-in factors get our checks first (AUTH-IMPLEMENTATION §3.2, §6). */
async function guardBetterAuth(c: Parameters<typeof authenticate>[0], path: string) {
  const sub = path.slice(`${V1}/auth`.length);
  const changesFactor = [
    '/two-factor/enable',
    '/two-factor/disable',
    '/two-factor/generate-backup-codes',
    '/passkey/generate-register-options',
    '/passkey/verify-registration',
    '/passkey/delete-passkey',
  ];
  if (!changesFactor.includes(sub)) return null;
  const denied = await authenticate(c);
  if (denied) return denied;
  const auth = c.var.auth;
  const deps = c.var.deps;
  const now = deps.clock.now();
  if (sub === '/two-factor/disable' && auth.mfaRequired) {
    return problemResponse(c, 'FORBIDDEN', {
      title: 'Not allowed',
      detail: 'Your role requires an authenticator or passkey.',
    });
  }
  // Adding the first factor is allowed on a recent sign-in; changing factors once one exists needs fresh strong auth,
  // so an attacker holding only the email inbox cannot add a passkey to an account that already has a factor.
  const [factors] = await deps.db.execute<{ has_factor: boolean }>(sql`
    SELECT EXISTS (SELECT 1 FROM passkeys WHERE user_id = ${auth.userId})
        OR EXISTS (SELECT 1 FROM two_factors WHERE user_id = ${auth.userId} AND verified) AS has_factor`);
  const ok = factors?.has_factor ? auth.isFresh(now) : auth.isRecent(now) || auth.isFresh(now);
  if (!ok)
    return problemResponse(c, 'REAUTH_REQUIRED', {
      title: 'Confirm it is you',
      detail: 'Verify again to change sign-in methods.',
    });
  return null;
}

export const session = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const path = c.req.path;
    if (!path.startsWith(V1) || PUBLIC_EXACT.includes(path) || startsWithAny(path, PUBLIC_PREFIXES))
      return next();
    if (path.startsWith(`${V1}/auth/`) && !startsWithAny(path, OWN_AUTH)) {
      const denied = await guardBetterAuth(c, path);
      return denied ?? next();
    }
    const denied = await authenticate(c);
    if (denied) return denied;
    const auth = c.var.auth;
    if (auth.mfaRequired && !auth.strongAuth && !startsWithAny(path, WEAK_ALLOWED)) {
      return problemResponse(c, 'MFA_REQUIRED', {
        title: 'Verification required',
        detail: 'Verify with a passkey or authenticator app.',
      });
    }
    return next();
  });
