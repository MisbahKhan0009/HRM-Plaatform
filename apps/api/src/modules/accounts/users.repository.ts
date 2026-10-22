import type { RoleCode, UserStatus } from '@hrm/contracts';
import { type Queryable, schema, type Tx } from '@hrm/db';
import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';

const { users, userRoles, roles, rolePermissions, invitations, employees } = schema;

const ts = (col: SQL) => sql`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export type UserRow = {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  last_login_at: string | null;
  status_changed_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  employee: { id: string; employeeCode: string; name: string; hasReports: boolean } | null;
  roles: RoleCode[];
  invitation_expires_at: string | null;
  has_passkey: boolean;
  has_totp: boolean;
  total: string;
};

const SELECT = sql`
  SELECT u.id, u.email, u.name, u.status, u.version,
    ${ts(sql`u.last_login_at`)} AS last_login_at,
    ${ts(sql`u.status_changed_at`)} AS status_changed_at,
    ${ts(sql`u.created_at`)} AS created_at,
    ${ts(sql`u.updated_at`)} AS updated_at,
    (SELECT json_build_object('id', e.id, 'employeeCode', e.employee_code,
        'name', coalesce(e.preferred_name, e.first_name) || ' ' || e.last_name,
        'hasReports', EXISTS (SELECT 1 FROM employees r WHERE r.manager_id = e.id AND r.status NOT IN ('separated', 'archived')))
      FROM employees e WHERE e.user_id = u.id AND e.company_id = u.company_id) AS employee,
    coalesce((SELECT json_agg(ro.code ORDER BY ro.code) FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id
      WHERE ur.user_id = u.id AND NOT ro.is_derived), '[]') AS roles,
    (SELECT ${ts(sql`i.expires_at`)} FROM invitations i
      WHERE i.user_id = u.id AND i.accepted_at IS NULL AND i.revoked_at IS NULL
      ORDER BY i.created_at DESC LIMIT 1) AS invitation_expires_at,
    EXISTS (SELECT 1 FROM passkeys p WHERE p.user_id = u.id) AS has_passkey,
    EXISTS (SELECT 1 FROM two_factors t WHERE t.user_id = u.id AND t.verified) AS has_totp,
    count(*) OVER () AS total
  FROM users u`;

export async function listUsers(
  db: Queryable,
  companyId: string,
  filter: { status?: UserStatus | undefined; q?: string | undefined },
  limit: number,
  offset: number,
) {
  const status = filter.status ? sql` AND u.status = ${filter.status}` : sql``;
  // Escape LIKE wildcards so `q` is a plain substring.
  const q = filter.q
    ? sql` AND (u.name ILIKE ${`%${filter.q.replace(/[\\%_]/g, '\\$&')}%`} OR u.email ILIKE ${`%${filter.q.replace(/[\\%_]/g, '\\$&')}%`})`
    : sql``;
  const rows = await db.execute<UserRow>(
    sql`${SELECT} WHERE u.company_id = ${companyId}${status}${q} ORDER BY u.name, u.id LIMIT ${limit} OFFSET ${offset}`,
  );
  return { rows: [...rows], total: Number(rows[0]?.total ?? 0) };
}

export async function findUser(db: Queryable, companyId: string, id: string) {
  const [row] = await db.execute<UserRow>(sql`${SELECT} WHERE u.company_id = ${companyId} AND u.id = ${id}`);
  return row ?? null;
}

/** Locks the user row for a state change (same company only). */
export async function lockUser(tx: Tx, companyId: string, id: string) {
  const [row] = await tx
    .select({ id: users.id, status: users.status, version: users.version, email: users.email })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.id, id)))
    .for('update');
  return row ?? null;
}

export async function emailExists(db: Queryable, email: string) {
  // users.email is citext: the comparison is case-insensitive.
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return Boolean(row);
}

export async function insertUser(tx: Tx, values: typeof users.$inferInsert) {
  await tx.insert(users).values(values);
}

export async function updateUser(
  tx: Tx,
  id: string,
  version: number,
  values: Partial<typeof users.$inferInsert>,
) {
  const [row] = await tx
    .update(users)
    .set({ ...values, version: sql`${users.version} + 1` })
    .where(and(eq(users.id, id), eq(users.version, version)))
    .returning({ id: users.id });
  return row?.id ?? null;
}

export async function findEmployee(db: Queryable, companyId: string, id: string) {
  const [row] = await db
    .select({ id: employees.id, userId: employees.userId })
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.id, id)));
  return row ?? null;
}

/** Links an employee to a user if it has no user yet; false when someone else holds the link. */
export async function linkEmployee(
  tx: Tx,
  companyId: string,
  employeeId: string,
  userId: string,
  by: string,
) {
  const [row] = await tx
    .update(employees)
    .set({ userId, updatedBy: by, updatedAt: sql`now()`, version: sql`${employees.version} + 1` })
    .where(and(eq(employees.companyId, companyId), eq(employees.id, employeeId), isNull(employees.userId)))
    .returning({ id: employees.id });
  return Boolean(row);
}

export function companyRoles(db: Queryable, companyId: string) {
  return db
    .select({
      id: roles.id,
      code: roles.code,
      isDerived: roles.isDerived,
      isActive: roles.isActive,
    })
    .from(roles)
    .where(eq(roles.companyId, companyId));
}

export async function explicitRoles(db: Queryable, userId: string) {
  return db
    .select({ roleId: userRoles.roleId, code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(userRoles.userId, userId), eq(roles.isDerived, false)));
}

export async function grantRoles(tx: Tx, userId: string, roleIds: string[], by: string) {
  if (!roleIds.length) return;
  await tx
    .insert(userRoles)
    .values(roleIds.map((roleId) => ({ userId, roleId, grantedBy: by })))
    .onConflictDoNothing();
}

export async function revokeRoles(tx: Tx, userId: string, roleIds: string[]) {
  if (!roleIds.length) return;
  await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), inArray(userRoles.roleId, roleIds)));
}

export async function insertInvitation(tx: Tx, values: typeof invitations.$inferInsert) {
  await tx.insert(invitations).values(values);
}

export async function revokeOpenInvitations(tx: Tx, userId: string, now: Date) {
  await tx
    .update(invitations)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(eq(invitations.userId, userId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)),
    );
}

/** Deletes every session of the user (FR-AUTH-006); returns how many were removed. */
export async function deleteSessions(tx: Tx, userId: string) {
  const rows = await tx
    .delete(schema.sessions)
    .where(eq(schema.sessions.userId, userId))
    .returning({ id: schema.sessions.id });
  return rows.length;
}

/** Removes passkeys and the authenticator (AUTH-IMPLEMENTATION §6). */
export async function deleteFactors(tx: Tx, userId: string) {
  const passkeys = await tx
    .delete(schema.passkeys)
    .where(eq(schema.passkeys.userId, userId))
    .returning({ id: schema.passkeys.id });
  const totp = await tx
    .delete(schema.twoFactors)
    .where(eq(schema.twoFactors.userId, userId))
    .returning({ id: schema.twoFactors.id });
  return { passkeys: passkeys.length, totp: totp.length > 0 };
}

// Roles -------------------------------------------------------------------------------------------------------------

export type RoleRow = {
  id: string;
  code: RoleCode;
  name: string;
  description: string | null;
  is_derived: boolean;
  requires_strong_auth: boolean;
  is_active: boolean;
  permissions: string[];
  user_count: string;
  version: number;
  updated_at: string;
};

const ROLE_SELECT = sql`
  SELECT r.id, r.code, r.name, r.description, r.is_derived, r.requires_strong_auth, r.is_active, r.version,
    ${ts(sql`r.updated_at`)} AS updated_at,
    coalesce((SELECT json_agg(rp.permission_code ORDER BY rp.permission_code) FROM role_permissions rp
      WHERE rp.role_id = r.id), '[]') AS permissions,
    (SELECT count(*) FROM user_roles ur JOIN users u ON u.id = ur.user_id
      WHERE ur.role_id = r.id AND u.status <> 'deactivated') AS user_count
  FROM roles r`;

export async function listRoles(db: Queryable, companyId: string) {
  return [
    ...(await db.execute<RoleRow>(
      sql`${ROLE_SELECT} WHERE r.company_id = ${companyId} ORDER BY r.created_at, r.code`,
    )),
  ];
}

export async function findRole(db: Queryable, companyId: string, id: string) {
  const [row] = await db.execute<RoleRow>(
    sql`${ROLE_SELECT} WHERE r.company_id = ${companyId} AND r.id = ${id}`,
  );
  return row ?? null;
}

export async function lockRole(tx: Tx, companyId: string, id: string) {
  const [row] = await tx
    .select()
    .from(roles)
    .where(and(eq(roles.companyId, companyId), eq(roles.id, id)))
    .for('update');
  return row ?? null;
}

export async function updateRole(
  tx: Tx,
  id: string,
  version: number,
  values: Partial<typeof roles.$inferInsert>,
) {
  const [row] = await tx
    .update(roles)
    .set({ ...values, version: sql`${roles.version} + 1` })
    .where(and(eq(roles.id, id), eq(roles.version, version)))
    .returning({ id: roles.id });
  return row?.id ?? null;
}

export async function rolePermissionCodes(db: Queryable, roleId: string) {
  const rows = await db
    .select({ code: rolePermissions.permissionCode })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  return rows.map((r) => r.code);
}

export async function setRolePermissions(
  tx: Tx,
  roleId: string,
  add: string[],
  remove: string[],
  by: string,
) {
  if (remove.length)
    await tx
      .delete(rolePermissions)
      .where(and(eq(rolePermissions.roleId, roleId), inArray(rolePermissions.permissionCode, remove)));
  if (add.length)
    await tx
      .insert(rolePermissions)
      .values(add.map((permissionCode) => ({ roleId, permissionCode, grantedBy: by })));
}

export function listPermissions(db: Queryable) {
  return db
    .select({ code: schema.permissions.code, description: schema.permissions.description })
    .from(schema.permissions)
    .orderBy(schema.permissions.code);
}
