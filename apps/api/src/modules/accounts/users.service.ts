import {
  type InviteUserInput,
  P,
  PERMISSIONS,
  type PermissionInfo,
  type ReplaceUserRolesInput,
  type Role,
  type RoleCode,
  type UpdateRoleInput,
  type UserAction,
  type UserActionInput,
  type UserDetail,
  type UserListQuery,
  type UserStatus,
  type UserSummary,
  WEAK_ROLE_PERMISSIONS,
} from '@hrm/contracts';
import { type Tx, uuidv7 } from '@hrm/db';
import { changes, recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import { randomToken, seal, sha256Hex } from '../../lib/crypto';
import { withDbErrors } from '../../lib/db-errors';
import type { Deps } from '../../lib/deps';
import { requireFresh, requirePermission, requireStrong } from '../../lib/guards';
import { enqueue, processOutbox } from '../../lib/outbox';
import { pageOffset } from '../../lib/pagination';
import {
  AppError,
  invalidTransition,
  notFound,
  ruleViolation,
  validationFailed,
  versionConflict,
} from '../../lib/problem';
import { getSetting } from '../../lib/settings';
import { usersPolicy as policy } from './users.policy';
import * as repo from './users.repository';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // AUTH-IMPLEMENTATION §4

const toSummary = (r: repo.UserRow): UserSummary => ({
  id: r.id,
  email: r.email,
  name: r.name,
  status: r.status,
  roles: r.roles,
  employee: r.employee
    ? { id: r.employee.id, employeeCode: r.employee.employeeCode, name: r.employee.name }
    : null,
  lastLoginAt: r.last_login_at,
  createdAt: r.created_at,
});

function toDetail(r: repo.UserRow, now: Date): UserDetail {
  const derivedRoles: RoleCode[] = [];
  if (r.employee) derivedRoles.push('employee');
  if (r.employee?.hasReports) derivedRoles.push('manager');
  return {
    ...toSummary(r),
    derivedRoles,
    statusChangedAt: r.status_changed_at,
    invitation:
      r.status === 'invited' && r.invitation_expires_at
        ? {
            expiresAt: r.invitation_expires_at,
            expired: new Date(r.invitation_expires_at).getTime() < now.getTime(),
          }
        : null,
    enrolment: { hasPasskey: r.has_passkey, hasTotp: r.has_totp },
    updatedAt: r.updated_at,
    version: r.version,
  };
}

export async function listUsers(deps: Deps, auth: AuthContext, q: UserListQuery) {
  policy.manageUsers(auth);
  const { rows, total } = await repo.listUsers(
    deps.db,
    auth.companyId,
    { status: q.status, q: q.q },
    q.pageSize,
    pageOffset(q),
  );
  return { items: rows.map(toSummary), total };
}

export async function getUser(deps: Deps, auth: AuthContext, id: string) {
  policy.manageUsers(auth);
  const row = await repo.findUser(deps.db, auth.companyId, id);
  if (!row) throw notFound();
  return toDetail(row, deps.clock.now());
}

/** Resolves explicit role codes to this company's active, non-derived roles. */
async function resolveRoles(deps: Deps, auth: AuthContext, codes: readonly string[], path: string) {
  if (!codes.length) return [];
  const all = await repo.companyRoles(deps.db, auth.companyId);
  const found = codes.map((code) => all.find((r) => r.code === code && r.isActive && !r.isDerived));
  const missing = codes.filter((_, i) => !found[i]);
  if (missing.length)
    throw validationFailed([
      { path, code: 'not_assignable', message: `Not assignable: ${missing.join(', ')}.` },
    ]);
  return found.map((r) => ({ id: r?.id as string, code: r?.code as string }));
}

/** Creates an invitation row and queues the email (AUTH-IMPLEMENTATION §4). The raw token only travels sealed. */
async function issueInvitation(deps: Deps, auth: AuthContext, tx: Tx, userId: string) {
  const token = randomToken();
  const now = deps.clock.now();
  const invitationId = uuidv7();
  await repo.insertInvitation(tx, {
    id: invitationId,
    companyId: auth.companyId,
    userId,
    tokenHash: await sha256Hex(token),
    expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    createdBy: auth.userId,
    updatedBy: auth.userId,
  });
  return enqueue(tx, auth.actor, {
    topic: 'email.invitation',
    payload: {
      userId,
      inviterUserId: auth.userId,
      sealedToken: await seal(deps.env.BETTER_AUTH_SECRET, token),
    },
    dedupeKey: `invitation:${invitationId}`,
  });
}

/** `POST /users/invitations`: an `invited` user, optional employee link and explicit roles, and the email. */
export async function inviteUser(deps: Deps, auth: AuthContext, input: InviteUserInput) {
  policy.manageUsers(auth);
  requireStrong(auth);
  const roleCodes = input.roleCodes ?? [];
  // Granting roles is role management: without this, user.manage alone could create a more privileged account.
  if (roleCodes.length) requirePermission(auth, P.role.manage);
  if (await repo.emailExists(deps.db, input.email)) throw emailTaken();
  if (input.employeeId) {
    const employee = await repo.findEmployee(deps.db, auth.companyId, input.employeeId);
    if (!employee)
      throw validationFailed([{ path: '/employeeId', code: 'not_found', message: 'Employee not found.' }]);
    if (employee.userId) throw alreadyLinked();
  }
  const grants = await resolveRoles(deps, auth, roleCodes, '/roleCodes');
  const locale = await getSetting(deps.db, auth.companyId, 'company.locale_default');
  const userId = uuidv7();
  const now = deps.clock.now();

  const outboxIds = await deps.db.transaction(async (tx) => {
    await withDbErrors(
      () =>
        repo.insertUser(tx, {
          id: userId,
          companyId: auth.companyId,
          email: input.email,
          name: input.name,
          status: 'invited',
          locale,
          statusChangedAt: now,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        }),
      { users_email_unique: { code: 'EMAIL_TAKEN', path: '/email' } },
    );
    if (input.employeeId) {
      const employeeId = input.employeeId;
      const linked = await withDbErrors(
        () => repo.linkEmployee(tx, auth.companyId, employeeId, userId, auth.userId),
        { employees_userId_unique: { code: 'EMPLOYEE_ALREADY_LINKED', path: '/employeeId' } },
      );
      if (!linked) throw alreadyLinked();
    }
    await repo.grantRoles(
      tx,
      userId,
      grants.map((g) => g.id),
      auth.userId,
    );
    await recordAudit(tx, auth.actor, {
      action: 'user.invited',
      category: 'security',
      entityType: 'user',
      entityId: userId,
      employeeId: input.employeeId ?? null,
      metadata: { roleCodes: grants.map((g) => g.code), employeeLinked: Boolean(input.employeeId) },
    });
    for (const g of grants) {
      await recordAudit(tx, auth.actor, {
        action: 'role.granted',
        category: 'security',
        entityType: 'user',
        entityId: userId,
        metadata: { roleCode: g.code },
      });
    }
    return issueInvitation(deps, auth, tx, userId);
  });
  deps.defer(processOutbox(deps, outboxIds));
  return getUser(deps, auth, userId);
}

const emailTaken = () =>
  new AppError('EMAIL_TAKEN', 'Email already used', undefined, [
    { path: '/email', code: 'duplicate', message: 'Already used.' },
  ]);
const alreadyLinked = () =>
  new AppError('EMPLOYEE_ALREADY_LINKED', 'Employee already has a user', undefined, [
    { path: '/employeeId', code: 'duplicate', message: 'Already linked to another user.' },
  ]);

/** `POST /users/{id}/invitations/resend`: revokes open tokens and sends a new one. */
export async function resendInvitation(deps: Deps, auth: AuthContext, id: string) {
  policy.manageUsers(auth);
  const outboxIds = await deps.db.transaction(async (tx) => {
    const user = await repo.lockUser(tx, auth.companyId, id);
    if (!user) throw notFound();
    if (user.status !== 'invited') throw invalidTransition(user.status, 'resend the invitation');
    await repo.revokeOpenInvitations(tx, id, deps.clock.now());
    await recordAudit(tx, auth.actor, {
      action: 'user.invitation_resent',
      category: 'security',
      entityType: 'user',
      entityId: id,
    });
    return issueInvitation(deps, auth, tx, id);
  });
  deps.defer(processOutbox(deps, outboxIds));
  return getUser(deps, auth, id);
}

/** Account transitions (DOMAIN-MODEL §5.1). Suspend and deactivate revoke every session in the same transaction. */
const TRANSITIONS: Record<UserAction, { from: readonly UserStatus[]; to: UserStatus; verb: string }> = {
  suspend: { from: ['active'], to: 'suspended', verb: 'suspend' },
  reactivate: { from: ['suspended'], to: 'active', verb: 'reactivate' },
  deactivate: { from: ['invited', 'active', 'suspended'], to: 'deactivated', verb: 'deactivate' },
};

const AUDIT_ACTION = {
  suspend: 'user.suspended',
  reactivate: 'user.reactivated',
  deactivate: 'user.deactivated',
} as const;

export async function changeUserStatus(
  deps: Deps,
  auth: AuthContext,
  id: string,
  action: UserAction,
  input: UserActionInput,
) {
  policy.manageUsers(auth);
  const now = deps.clock.now();
  requireFresh(auth, now);
  policy.notSelf(auth, id);
  const t = TRANSITIONS[action];
  await deps.db.transaction(async (tx) => {
    const user = await repo.lockUser(tx, auth.companyId, id);
    if (!user) throw notFound();
    policy.actOnAccount(
      auth,
      (await repo.explicitRoles(tx, id)).map((r) => r.code),
    );
    if (!t.from.includes(user.status)) throw invalidTransition(user.status, t.verb);
    const updated = await repo.updateUser(tx, id, input.version, {
      status: t.to,
      statusChangedAt: now,
      updatedAt: now,
      updatedBy: auth.userId,
    });
    if (!updated) throw versionConflict();
    const sessionsRevoked = t.to === 'active' ? 0 : await repo.deleteSessions(tx, id);
    if (user.status === 'invited') await repo.revokeOpenInvitations(tx, id, now);
    await recordAudit(tx, auth.actor, {
      action: AUDIT_ACTION[action],
      category: 'security',
      entityType: 'user',
      entityId: id,
      metadata: {
        from: user.status,
        to: t.to,
        sessionsRevoked,
        ...(input.reason ? { comment: input.reason } : {}),
      },
    });
  });
  return getUser(deps, auth, id);
}

/** `POST /users/{id}/reset-auth` (AUTH-IMPLEMENTATION §6): removes passkeys and TOTP, revokes sessions, emails. */
export async function resetAuth(deps: Deps, auth: AuthContext, id: string, input: UserActionInput) {
  policy.manageUsers(auth);
  const now = deps.clock.now();
  requireFresh(auth, now);
  policy.notSelf(auth, id);
  const outboxIds = await deps.db.transaction(async (tx) => {
    const user = await repo.lockUser(tx, auth.companyId, id);
    if (!user) throw notFound();
    policy.actOnAccount(
      auth,
      (await repo.explicitRoles(tx, id)).map((r) => r.code),
    );
    if (user.status !== 'active' && user.status !== 'suspended')
      throw ruleViolation('Only active or suspended accounts have sign-in methods to reset.');
    const updated = await repo.updateUser(tx, id, input.version, {
      twoFactorEnabled: false,
      updatedAt: now,
      updatedBy: auth.userId,
    });
    if (!updated) throw versionConflict();
    const removed = await repo.deleteFactors(tx, id);
    const sessionsRevoked = await repo.deleteSessions(tx, id);
    await recordAudit(tx, auth.actor, {
      action: 'user.auth_reset',
      category: 'security',
      entityType: 'user',
      entityId: id,
      metadata: {
        passkeysRemoved: removed.passkeys,
        totpRemoved: removed.totp,
        sessionsRevoked,
        ...(input.reason ? { comment: input.reason } : {}),
      },
    });
    return enqueue(tx, auth.actor, { topic: 'email.auth_reset', payload: { userId: id } });
  });
  deps.defer(processOutbox(deps, outboxIds));
  return getUser(deps, auth, id);
}

/** `POST /users/{id}/roles`: replaces the explicit roles; each grant and revocation is audited (FR-AUD-002). */
export async function replaceRoles(deps: Deps, auth: AuthContext, id: string, input: ReplaceUserRolesInput) {
  policy.manageRoles(auth);
  const now = deps.clock.now();
  requireFresh(auth, now);
  policy.notSelf(auth, id);
  const wanted = await resolveRoles(deps, auth, input.roleCodes, '/roleCodes');
  await deps.db.transaction(async (tx) => {
    const user = await repo.lockUser(tx, auth.companyId, id);
    if (!user) throw notFound();
    const updated = await repo.updateUser(tx, id, input.version, { updatedAt: now, updatedBy: auth.userId });
    if (!updated) throw versionConflict();
    const current = await repo.explicitRoles(tx, id);
    const add = wanted.filter((w) => !current.some((c) => c.roleId === w.id));
    const remove = current.filter((c) => !wanted.some((w) => w.id === c.roleId));
    await repo.revokeRoles(
      tx,
      id,
      remove.map((r) => r.roleId),
    );
    await repo.grantRoles(
      tx,
      id,
      add.map((r) => r.id),
      auth.userId,
    );
    for (const r of add)
      await recordAudit(tx, auth.actor, {
        action: 'role.granted',
        category: 'security',
        entityType: 'user',
        entityId: id,
        metadata: { roleCode: r.code },
      });
    for (const r of remove)
      await recordAudit(tx, auth.actor, {
        action: 'role.revoked',
        category: 'security',
        entityType: 'user',
        entityId: id,
        metadata: { roleCode: r.code },
      });
  });
  return getUser(deps, auth, id);
}

// Roles and permissions ---------------------------------------------------------------------------------------------

const toRole = (r: repo.RoleRow): Role => ({
  id: r.id,
  code: r.code,
  name: r.name,
  description: r.description,
  isDerived: r.is_derived,
  assignable: !r.is_derived && r.is_active,
  requiresStrongAuth: r.requires_strong_auth,
  isActive: r.is_active,
  permissions: r.permissions.filter((p) => (PERMISSIONS as string[]).includes(p)) as Role['permissions'],
  userCount: r.is_derived ? 0 : Number(r.user_count),
  version: r.version,
  updatedAt: r.updated_at,
});

export async function listRoles(deps: Deps, auth: AuthContext) {
  policy.readRoles(auth);
  return (await repo.listRoles(deps.db, auth.companyId)).map(toRole);
}

/**
 * `PATCH /roles/{id}`: name, description and the full permission set. Derived roles can be edited (their grants
 * apply to everyone who derives them) but never assigned. A caller cannot remove `role.manage` from a role they hold,
 * which would lock role management out with no one able to restore it from this account.
 */
export async function updateRole(deps: Deps, auth: AuthContext, id: string, input: UpdateRoleInput) {
  policy.manageRoles(auth);
  const now = deps.clock.now();
  requireFresh(auth, now);
  const { version, permissions, ...fields } = input;
  await deps.db.transaction(async (tx) => {
    const before = await repo.lockRole(tx, auth.companyId, id);
    if (!before) throw notFound();
    const current = await repo.rolePermissionCodes(tx, id);
    const add = permissions ? permissions.filter((p) => !current.includes(p)) : [];
    const remove = permissions ? current.filter((p) => !permissions.includes(p as never)) : [];
    if (remove.includes(P.role.manage) && auth.roles.includes(before.code as RoleCode))
      throw ruleViolation('You cannot remove role management from a role you hold.', [
        { path: '/permissions', code: 'self_lockout', message: 'Keep role.manage on your own role.' },
      ]);
    // A role usable without a strong sign-in must not carry sensitive permissions (D-049, C11).
    const tooStrong = before.requiresStrongAuth ? [] : add.filter((p) => !WEAK_ROLE_PERMISSIONS.has(p));
    if (tooStrong.length)
      throw ruleViolation(
        'This role does not require a passkey or authenticator, so it cannot hold these permissions.',
        tooStrong.map((p) => ({ path: '/permissions', code: 'needs_strong_auth', message: p })),
      );
    const updated = await repo.updateRole(tx, id, version, {
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.description !== undefined ? { description: fields.description } : {}),
      updatedAt: now,
      updatedBy: auth.userId,
    });
    if (!updated) throw versionConflict();
    await repo.setRolePermissions(tx, id, add, remove, auth.userId);
    const fieldChanges = changes(before, { ...before, ...fields }, Object.keys(fields));
    if (Object.keys(fieldChanges).length)
      await recordAudit(tx, auth.actor, {
        action: 'role.updated',
        category: 'security',
        entityType: 'role',
        entityId: id,
        metadata: { roleCode: before.code, changes: fieldChanges },
      });
    if (add.length || remove.length)
      await recordAudit(tx, auth.actor, {
        action: 'role.permissions_changed',
        category: 'security',
        entityType: 'role',
        entityId: id,
        metadata: { roleCode: before.code, added: add.sort(), removed: remove.sort() },
      });
  });
  const row = await repo.findRole(deps.db, auth.companyId, id);
  if (!row) throw notFound();
  return toRole(row);
}

export async function listPermissions(deps: Deps, auth: AuthContext): Promise<PermissionInfo[]> {
  policy.manageRoles(auth);
  const rows = await repo.listPermissions(deps.db);
  return rows.filter((r) => (PERMISSIONS as string[]).includes(r.code)) as PermissionInfo[];
}
