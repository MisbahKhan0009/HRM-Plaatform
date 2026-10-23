import { DEFAULT_ROLES, describePermission, PERMISSIONS, SETTINGS, type SettingKey } from '@hrm/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './client';
import { uuidv7 } from './ids';
import {
  codeSequences,
  companies,
  leavePolicies,
  leaveTypes,
  permissions,
  rolePermissions,
  roles,
  settings,
  userRoles,
  users,
  workSchedules,
} from './schema';
import { jsonValue } from './scope';

export interface SeedOptions {
  companyName: string;
  /** First administrator; created active so they can sign in with an email code and invite everyone else. */
  admin?: { email: string; name: string; roleCodes: readonly string[] };
  /** First leave year for the seeded policies. */
  policyYear: number;
}

/**
 * Baseline data every environment needs (idempotent: safe to run again). Values follow SECURITY-MODEL §4,
 * BUSINESS-RULES §5 and §9 and D-042; the leave values are labelled seed defaults to be verified by the owner.
 */
export async function seedBaseline(
  db: Db,
  options: SeedOptions,
): Promise<{ companyId: string; adminUserId?: string }> {
  const [existing] = await db.select({ id: companies.id }).from(companies).limit(1);
  return seedCompany(db, { ...options, companyId: existing?.id ?? uuidv7() });
}

/**
 * Creates (or completes) one company with its roles, settings, schedule and leave types. Tests call it with a fresh id
 * so each test file has its own isolated company (D-001: everything is company-scoped).
 */
export async function seedCompany(
  db: Db,
  options: SeedOptions & { companyId: string },
): Promise<{ companyId: string; adminUserId?: string }> {
  return db.transaction(async (tx) => {
    const companyId = options.companyId;
    await tx.insert(companies).values({ id: companyId, name: options.companyName }).onConflictDoNothing();

    await tx
      .insert(permissions)
      .values(PERMISSIONS.map((code) => ({ code, description: describePermission(code) })))
      .onConflictDoUpdate({ target: permissions.code, set: { description: sql`excluded.description` } });

    for (const role of DEFAULT_ROLES) {
      const [row] = await tx
        .insert(roles)
        .values({
          id: uuidv7(),
          companyId,
          code: role.code,
          name: role.name,
          description: role.description,
          isDerived: role.isDerived,
          requiresStrongAuth: role.requiresStrongAuth,
        })
        .onConflictDoNothing()
        .returning({ id: roles.id });
      // Grants are seeded only when the role is created, so later edits through role.manage are kept.
      if (row) {
        await tx
          .insert(rolePermissions)
          .values(role.permissions.map((p) => ({ roleId: row.id, permissionCode: p })));
      }
    }

    await tx
      .insert(settings)
      .values(
        (Object.keys(SETTINGS) as SettingKey[]).map((key) => ({
          companyId,
          key,
          scope: SETTINGS[key].scope,
          value: jsonValue(SETTINGS[key].default),
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(codeSequences)
      .values(
        ['employee', 'leave_request', 'reimbursement_claim', 'payroll_run'].map((scope) => ({
          companyId,
          scope,
        })),
      )
      .onConflictDoNothing();

    const [schedule] = await tx
      .select({ id: workSchedules.id })
      .from(workSchedules)
      .where(and(eq(workSchedules.companyId, companyId), eq(workSchedules.isDefault, true)));
    if (!schedule) {
      // D-005 Sun–Thu (0 = Sunday), D-010/D-042 core hours 10:00–16:00, 8 h minimum.
      await tx.insert(workSchedules).values({
        id: uuidv7(),
        companyId,
        name: 'Standard day shift',
        workingDays: [0, 1, 2, 3, 4],
        coreStart: '10:00',
        coreEnd: '16:00',
        minDailyMinutes: 480,
        isDefault: true,
      });
    }

    const from = `${options.policyYear}-01-01`;
    const leaveSeed = [
      {
        code: 'CL',
        name: 'Casual leave',
        sortOrder: 1,
        policy: { allocationMethod: 'annual_grant', annualEntitlement: '10.00' },
      },
      {
        code: 'SL',
        name: 'Sick leave',
        sortOrder: 2,
        policy: { allocationMethod: 'annual_grant', annualEntitlement: '14.00' },
      },
      {
        code: 'AL',
        name: 'Earned leave',
        sortOrder: 3,
        policy: {
          allocationMethod: 'per_days_worked',
          daysWorkedPerUnit: '18.00',
          eligibilityAfterDays: 365,
          maxBalance: '40.00',
        },
      },
      { code: 'COMP', name: 'Compensatory leave', sortOrder: 4, policy: { allocationMethod: 'manual' } },
    ] as const;
    for (const t of leaveSeed) {
      const [type] = await tx
        .insert(leaveTypes)
        .values({ id: uuidv7(), companyId, code: t.code, name: t.name, sortOrder: t.sortOrder })
        .onConflictDoNothing()
        .returning({ id: leaveTypes.id });
      if (type)
        await tx
          .insert(leavePolicies)
          .values({ id: uuidv7(), companyId, leaveTypeId: type.id, effectiveFrom: from, ...t.policy });
    }

    let adminUserId: string | undefined;
    if (options.admin) {
      const [found] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, options.admin.email));
      adminUserId = found?.id ?? uuidv7();
      if (!found) {
        await tx.insert(users).values({
          id: adminUserId,
          companyId,
          email: options.admin.email,
          name: options.admin.name,
          emailVerified: true,
          status: 'active',
          statusChangedAt: sql`now()`,
        });
      }
      const wanted = await tx
        .select({ id: roles.id, code: roles.code, isDerived: roles.isDerived })
        .from(roles)
        .where(eq(roles.companyId, companyId));
      const grants = wanted.filter((r) => !r.isDerived && options.admin?.roleCodes.includes(r.code));
      if (grants.length) {
        await tx
          .insert(userRoles)
          .values(grants.map((r) => ({ userId: adminUserId as string, roleId: r.id })))
          .onConflictDoNothing();
      }
    }
    return adminUserId ? { companyId, adminUserId } : { companyId };
  });
}
