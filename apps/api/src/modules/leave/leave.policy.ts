import { P } from '@hrm/contracts';
import type { RequestScope } from '@hrm/db';
import type { AuthContext } from '../../lib/auth-context';
import { requirePermission } from '../../lib/guards';

/** Union of employee scopes; `all` wins. */
function union(companyId: string, ...scopes: RequestScope[]): RequestScope {
  if (scopes.some((s) => s.employees === 'all')) return { companyId, employees: 'all' };
  const ids = new Set<string>();
  for (const s of scopes) for (const id of s.employees as readonly string[]) ids.add(id);
  return { companyId, employees: [...ids] };
}

/**
 * Authorization for the leave module (SECURITY-MODEL §4, API-CATALOGUE §6). A `null` scope means no access: by-id
 * actions answer 404, list actions 403.
 */
export const leavePolicy = {
  managePolicies: (auth: AuthContext) => requirePermission(auth, P.leave.policy.manage),
  adjustBalances: (auth: AuthContext) => requirePermission(auth, P.leave.balance.adjust),

  /** Leave readers: `leave.read.all` or `.team` (team plus their own). */
  async readScope(auth: AuthContext): Promise<RequestScope | null> {
    if (auth.can(P.leave.read.all)) return auth.scopeAll();
    if (auth.can(P.leave.read.team)) return union(auth.companyId, await auth.scopeTeam(), auth.scopeOwn());
    return null;
  },

  /** Requests and ledgers a caller may see: read scope, review scope and their own. */
  async viewScope(auth: AuthContext): Promise<RequestScope | null> {
    const scopes: RequestScope[] = [];
    const read = await leavePolicy.readScope(auth);
    if (read) scopes.push(read);
    const review = await leavePolicy.reviewScope(auth);
    if (review) scopes.push(review);
    if (auth.can(P.leave.request.own) && auth.employeeId) scopes.push(auth.scopeOwn());
    return scopes.length ? union(auth.companyId, ...scopes) : null;
  },

  /** Reviewers: `leave.request.review.all` (HR) or `.team` (managers, D-014). */
  async reviewScope(auth: AuthContext): Promise<RequestScope | null> {
    if (auth.can(P.leave.request.review.all)) return auth.scopeAll();
    if (auth.can(P.leave.request.review.team)) return auth.scopeTeam();
    return null;
  },

  /** Own self-service needs `leave.request.own` and a linked employee (FR-ATT-012 pattern: employee from session). */
  ownEmployee(auth: AuthContext): string | null {
    return auth.can(P.leave.request.own) ? auth.employeeId : null;
  },

  /** HR may create, preview and cancel on an employee's behalf (D-014, audited). */
  canActOnBehalf: (auth: AuthContext) => auth.can(P.leave.request.review.all),

  /** Employees see colleagues' approved leave only when the setting is on (FR-LEAVE-011, D-042). */
  canSeeLeaveTypes: (auth: AuthContext) => auth.canAny(P.leave.read.all, P.leave.read.team),
};
