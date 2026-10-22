import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyColumn, standardColumns, tsz, userRef } from './columns';
import { users } from './users';

// DATA-MODEL.md §2. Roles and grants are seeded from SECURITY-MODEL.md §4.
export const roles = pgTable(
  'roles',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    code: text().notNull(),
    name: text().notNull(),
    description: text(),
    isDerived: boolean().notNull().default(false),
    requiresStrongAuth: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    ...standardColumns(),
  },
  (t) => [
    unique('roles_code_uq').on(t.companyId, t.code),
    check('roles_code_fmt', sql`${t.code} ~ '^[a-z_]{3,40}$'`),
  ],
);

export const permissions = pgTable(
  'permissions',
  {
    code: text().primaryKey(),
    description: text().notNull(),
  },
  (t) => [check('permissions_code_fmt', sql`${t.code} ~ '^[a-z_]+(\\.[a-z_]+){1,3}$'`)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    permissionCode: text()
      .notNull()
      .references(() => permissions.code, { onDelete: 'restrict' }),
    grantedBy: userRef(),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionCode] })],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    grantedBy: userRef(),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] }), index('user_roles_role_idx').on(t.roleId)],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tokenHash: text().notNull().unique(),
    expiresAt: tsz().notNull(),
    acceptedAt: tsz(),
    revokedAt: tsz(),
    ...standardColumns(),
  },
  (t) => [index('invitations_user_idx').on(t.userId)],
);
