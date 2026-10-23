import { P } from '@hrm/contracts';
import type { RequestScope } from '@hrm/db';
import type { AuthContext } from '../../lib/auth-context';
import { forbidden } from '../../lib/problem';

/** Authorization for reimbursement claims (SECURITY-MODEL §4, API-CATALOGUE §7). */
export const reimbursementsPolicy = {
  /**
   * Claims the caller may read: everything with `reimbursement.read.all` or `.review.all`; their team and their own
   * with `.review.team`; their own with `.request.own`. Null means no read access (403 on lists, 404 by id).
   */
  async readScope(auth: AuthContext): Promise<RequestScope | null> {
    if (auth.canAny(P.reimbursement.read.all, P.reimbursement.review.all)) return auth.scopeAll();
    const own = auth.can(P.reimbursement.request.own) ? auth.scopeOwn() : null;
    if (auth.can(P.reimbursement.review.team)) {
      const team = await auth.scopeTeam();
      const ids = [
        ...(team.employees === 'all' ? [] : team.employees),
        ...(own ? (own.employees as string[]) : []),
      ];
      return { companyId: auth.companyId, employees: ids };
    }
    return own;
  },

  /** Own draft work and submit/withdraw: the employee comes from the session, never the request (AGENTS.md). */
  ownEmployee(auth: AuthContext): string {
    if (!auth.can(P.reimbursement.request.own) || !auth.employeeId) throw forbidden();
    return auth.employeeId;
  },

  ownScope(auth: AuthContext): RequestScope | null {
    return auth.can(P.reimbursement.request.own) && auth.employeeId ? auth.scopeOwn() : null;
  },

  /** Claims the caller may decide: all with `.review.all`, their team with `.review.team` (FR-REIM-002). */
  async reviewScope(auth: AuthContext): Promise<RequestScope | null> {
    if (auth.can(P.reimbursement.review.all)) return auth.scopeAll();
    if (auth.can(P.reimbursement.review.team)) return auth.scopeTeam();
    return null;
  },
};
