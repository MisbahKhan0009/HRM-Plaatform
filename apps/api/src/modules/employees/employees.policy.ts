import { P } from '@hrm/contracts';
import type { RequestScope } from '@hrm/db';
import type { AuthContext } from '../../lib/auth-context';
import { requirePermission } from '../../lib/guards';
import { forbidden } from '../../lib/problem';

export type EmployeeView = 'full' | 'self' | 'basic';

/**
 * Authorization for the employees module (SECURITY-MODEL §3-§5). By-id reads return the view the caller may see,
 * or null, which the service turns into 404 (IDOR rule). List and create endpoints return 403.
 */
export const employeesPolicy = {
  manage: (auth: AuthContext) => requirePermission(auth, P.employee.manage),

  /** Employee list scope: `.all` wins over `.team`; `.own` alone may not list (US-EMP-002). */
  async listScope(auth: AuthContext): Promise<RequestScope> {
    if (auth.can(P.employee.read.all)) return auth.scopeAll();
    if (auth.can(P.employee.read.team)) return auth.scopeTeam();
    throw forbidden();
  },

  /** Which DTO the caller gets for an employee (SECURITY-MODEL §5), or null when it is out of scope. */
  async view(auth: AuthContext, employeeId: string): Promise<EmployeeView | null> {
    if (auth.can(P.employee.read.all)) return 'full';
    if (auth.employeeId === employeeId && auth.can(P.employee.read.own)) return 'self';
    if (auth.can(P.employee.read.team) && (await auth.isInTeam(employeeId))) return 'basic';
    return null;
  },

  /** Restricted contact data: `employee.contact.read.all`, or the caller's own record. */
  readContact: (auth: AuthContext, employeeId: string) =>
    auth.can(P.employee.contact.read.all) || auth.employeeId === employeeId,

  /**
   * Employment history: `.all` and own see every event; a manager sees their reports' history without
   * `salary_changed` events (US-EMP-005). Null means out of scope.
   */
  async historyAccess(auth: AuthContext, employeeId: string): Promise<{ hideSalary: boolean } | null> {
    if (auth.can(P.employee.read.all)) return { hideSalary: false };
    if (auth.employeeId === employeeId && auth.can(P.employee.read.own)) return { hideSalary: false };
    if (auth.can(P.employee.read.team) && (await auth.isInTeam(employeeId))) return { hideSalary: true };
    return null;
  },

  /** Contracts: `employee.read.all` or own (API-CATALOGUE §4). */
  readContracts: (auth: AuthContext, employeeId: string) =>
    auth.can(P.employee.read.all) || (auth.employeeId === employeeId && auth.can(P.employee.read.own)),

  readOwn: (auth: AuthContext) => requirePermission(auth, P.employee.read.own),

  requestProfileChange: (auth: AuthContext) => requirePermission(auth, P.profileChange.request.own),
  reviewProfileChanges: (auth: AuthContext) => auth.can(P.profileChange.review.all),
  listProfileChanges: (auth: AuthContext) =>
    requirePermission(auth, P.profileChange.review.all, P.profileChange.request.own),
};
