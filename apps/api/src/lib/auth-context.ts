import type { Permission, RoleCode } from '@hrm/contracts';
import type { Queryable, RequestScope } from '@hrm/db';
import { sql } from 'drizzle-orm';

/** Who performs an action; audit rows take actor, request id, IP and user agent from here (AUDIT.md §2). */
export interface Actor {
  companyId: string;
  userId: string | null;
  type: 'user' | 'system';
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export const systemActor = (companyId: string, requestId: string | null = null): Actor => ({
  companyId,
  userId: null,
  type: 'system',
  requestId,
  ipAddress: null,
  userAgent: null,
});

export interface SessionInfo {
  id: string;
  authMethod: 'passkey' | 'email_otp' | null;
  strongAuthAt: Date | null;
  createdAt: Date;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  status: 'invited' | 'active' | 'suspended' | 'deactivated';
  theme: 'ink' | 'paper';
  locale: 'en' | 'bn';
}

export interface LinkedEmployee {
  id: string;
  employeeCode: string;
  name: string;
  hasDirectReports: boolean;
}

const FRESH_MS = 15 * 60 * 1000;

/**
 * The authenticated caller for one request (SECURITY-MODEL §2–§3): effective roles and permissions, session
 * strength, and the record scopes policies use. Built once per request by the session middleware.
 */
export class AuthContext {
  private teamScope: Promise<RequestScope> | null = null;

  constructor(
    readonly user: AuthUser,
    readonly companyId: string,
    readonly employee: LinkedEmployee | null,
    readonly roles: readonly RoleCode[],
    private readonly granted: ReadonlySet<string>,
    readonly session: SessionInfo,
    readonly actor: Actor,
    private readonly db: Queryable,
    /** A held role has `requires_strong_auth` (D-006, D-033). */
    readonly mfaRequired: boolean,
    /** Permissions of roles that do not need strong auth: what a weak privileged session may see (AUTH-IMPLEMENTATION §9). */
    readonly weakPermissions: readonly Permission[],
  ) {}

  get userId() {
    return this.user.id;
  }

  get employeeId() {
    return this.employee?.id ?? null;
  }

  get strongAuth() {
    return this.session.strongAuthAt !== null;
  }

  /** Strong auth within the last 15 minutes (SECURITY-MODEL §7). */
  isFresh(now: Date) {
    const at = this.session.strongAuthAt;
    return at !== null && now.getTime() - at.getTime() <= FRESH_MS;
  }

  /** Session created within the last 15 minutes (used for first-factor enrolment on a weak session). */
  isRecent(now: Date) {
    return now.getTime() - this.session.createdAt.getTime() <= FRESH_MS;
  }

  can(permission: Permission) {
    return this.granted.has(permission);
  }

  canAny(...permissions: Permission[]) {
    return permissions.some((p) => this.granted.has(p));
  }

  get permissions(): Permission[] {
    return [...this.granted] as Permission[];
  }

  scopeAll(): RequestScope {
    return { companyId: this.companyId, employees: 'all' };
  }

  /** The caller's own employee; an empty list when no employee is linked. */
  scopeOwn(): RequestScope {
    return { companyId: this.companyId, employees: this.employeeId ? [this.employeeId] : [] };
  }

  /** Direct and indirect reports, excluding the caller (BUSINESS-RULES §7.2). Computed once per request. */
  scopeTeam(): Promise<RequestScope> {
    this.teamScope ??= this.loadTeam();
    return this.teamScope;
  }

  /** Whether an employee is in the caller's team. */
  async isInTeam(employeeId: string) {
    const team = await this.scopeTeam();
    return team.employees !== 'all' && team.employees.includes(employeeId);
  }

  private async loadTeam(): Promise<RequestScope> {
    if (!this.employeeId) return { companyId: this.companyId, employees: [] };
    const rows = await this.db.execute<{ id: string }>(sql`
      WITH RECURSIVE team AS (
        SELECT id, 1 AS depth FROM employees WHERE manager_id = ${this.employeeId} AND company_id = ${this.companyId}
        UNION ALL
        SELECT e.id, t.depth + 1 FROM employees e JOIN team t ON e.manager_id = t.id WHERE t.depth < 50
      )
      SELECT DISTINCT id FROM team WHERE id <> ${this.employeeId}`);
    return { companyId: this.companyId, employees: rows.map((r) => r.id) };
  }
}
