import { z } from 'zod';
import { RoleCodeSchema, UserStatusSchema } from './auth';
import { VersionSchema } from './common';
import { ASSIGNABLE_ROLES, PERMISSIONS } from './permissions';
import { PageQuerySchema } from './primitives';

// Users and roles (API-CATALOGUE §2, AUTH-IMPLEMENTATION §4 and §6).

/** Explicit roles only: `manager` and `employee` are derived and never assignable (SECURITY-MODEL §2). */
export const AssignableRoleCodeSchema = z.enum(ASSIGNABLE_ROLES as [string, ...string[]]);

const roleCodes = z
  .array(AssignableRoleCodeSchema)
  .max(ASSIGNABLE_ROLES.length)
  .refine((a) => new Set(a).size === a.length, { message: 'Each role once' });

export const UserListQuerySchema = PageQuerySchema.extend({
  status: UserStatusSchema.optional(),
  /** Matches name or email (case-insensitive substring). */
  q: z.string().trim().min(1).max(100).optional(),
}).strict();
export type UserListQuery = z.infer<typeof UserListQuerySchema>;

const LinkedEmployeeSchema = z.object({ id: z.uuid(), employeeCode: z.string(), name: z.string() });

export const UserSummarySchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  status: UserStatusSchema,
  /** Explicit roles from `user_roles`. */
  roles: z.array(RoleCodeSchema),
  employee: LinkedEmployeeSchema.nullable(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});
export type UserSummary = z.infer<typeof UserSummarySchema>;

export const UserDetailSchema = UserSummarySchema.extend({
  /** Roles derived from data: `employee` (linked employee) and `manager` (has direct reports). */
  derivedRoles: z.array(RoleCodeSchema),
  statusChangedAt: z.string().nullable(),
  /** The open invitation of an `invited` user; null otherwise. */
  invitation: z.object({ expiresAt: z.string(), expired: z.boolean() }).nullable(),
  enrolment: z.object({ hasPasskey: z.boolean(), hasTotp: z.boolean() }),
  updatedAt: z.string(),
  version: z.number().int(),
});
export type UserDetail = z.infer<typeof UserDetailSchema>;

export const InviteUserInputSchema = z
  .object({
    email: z.email().max(254),
    name: z.string().trim().min(1).max(200),
    employeeId: z.uuid().optional(),
    /** Granting roles at invitation also needs `role.manage`. */
    roleCodes: roleCodes.optional(),
  })
  .strict();
export type InviteUserInput = z.infer<typeof InviteUserInputSchema>;

/** Account transitions with their own endpoint (DOMAIN-MODEL §5.1); `accept` is the invitee's. */
export type UserAction = 'suspend' | 'reactivate' | 'deactivate';

/** Body of suspend, reactivate, deactivate and reset-auth: the version the client read (API-STANDARDS §8). */
export const UserActionInputSchema = z
  .object({ version: VersionSchema, reason: z.string().trim().min(1).max(500).optional() })
  .strict();
export type UserActionInput = z.infer<typeof UserActionInputSchema>;

export const ReplaceUserRolesInputSchema = z.object({ roleCodes, version: VersionSchema }).strict();
export type ReplaceUserRolesInput = z.infer<typeof ReplaceUserRolesInputSchema>;

export const PermissionCodeSchema = z.enum(PERMISSIONS as [string, ...string[]]);

export const RoleSchema = z.object({
  id: z.uuid(),
  code: RoleCodeSchema,
  name: z.string(),
  description: z.string().nullable(),
  isDerived: z.boolean(),
  /** Assignable through `POST /users/{id}/roles` (explicit, active roles only). */
  assignable: z.boolean(),
  requiresStrongAuth: z.boolean(),
  isActive: z.boolean(),
  permissions: z.array(PermissionCodeSchema),
  /** Users holding the role explicitly (derived roles: 0). */
  userCount: z.number().int(),
  version: z.number().int(),
  updatedAt: z.string(),
});
export type Role = z.infer<typeof RoleSchema>;

export const UpdateRoleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    /** The full permission set (replaces the current grants). */
    permissions: z
      .array(PermissionCodeSchema)
      .max(PERMISSIONS.length)
      .refine((a) => new Set(a).size === a.length, { message: 'Each permission once' })
      .optional(),
    version: VersionSchema,
  })
  .strict();
export type UpdateRoleInput = z.infer<typeof UpdateRoleInputSchema>;

export const PermissionInfoSchema = z.object({ code: PermissionCodeSchema, description: z.string() });
export type PermissionInfo = z.infer<typeof PermissionInfoSchema>;
