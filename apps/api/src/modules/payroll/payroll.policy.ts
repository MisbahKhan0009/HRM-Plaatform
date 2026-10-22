import { P } from '@hrm/contracts';
import type { RequestScope } from '@hrm/db';
import type { AuthContext } from '../../lib/auth-context';
import { requireFresh, requirePermission, requireStrong } from '../../lib/guards';

/**
 * Authorization for payroll (SECURITY-MODEL §4, API-CATALOGUE §8). Runs, items, payments and adjustments are
 * company-wide records: a caller without the permission gets 403. Salary structures and payslips are per employee:
 * outside the caller's scope they are 404.
 */
export const payrollPolicy = {
  /** `compensation.read.all`, or the caller's own structures with `compensation.read.own`. */
  compensationScope(auth: AuthContext): RequestScope | null {
    if (auth.can(P.compensation.read.all)) return auth.scopeAll();
    if (auth.can(P.compensation.read.own) && auth.employeeId) return auth.scopeOwn();
    return null;
  },
  manageCompensation(auth: AuthContext) {
    requirePermission(auth, P.compensation.manage);
    requireStrong(auth);
  },
  approveCompensation(auth: AuthContext, now: Date) {
    requirePermission(auth, P.compensation.manage);
    requireFresh(auth, now);
  },

  read: (auth: AuthContext) => requirePermission(auth, P.payroll.read.all),
  prepare: (auth: AuthContext) => requirePermission(auth, P.payroll.prepare),
  prepareStrong(auth: AuthContext) {
    requirePermission(auth, P.payroll.prepare);
    requireStrong(auth);
  },
  approveStrong(auth: AuthContext) {
    requirePermission(auth, P.payroll.approve);
    requireStrong(auth);
  },
  approveFresh(auth: AuthContext, now: Date) {
    requirePermission(auth, P.payroll.approve);
    requireFresh(auth, now);
  },
  approve: (auth: AuthContext) => requirePermission(auth, P.payroll.approve),
  lockFresh(auth: AuthContext, now: Date) {
    requirePermission(auth, P.payroll.lock);
    requireFresh(auth, now);
  },
  payFresh(auth: AuthContext, now: Date) {
    requirePermission(auth, P.payroll.pay);
    requireFresh(auth, now);
  },

  /** `payslip.read.all`, or the caller's own payslips with `payslip.read.own`. */
  payslipScope(auth: AuthContext): RequestScope | null {
    if (auth.can(P.payslip.read.all)) return auth.scopeAll();
    if (auth.can(P.payslip.read.own) && auth.employeeId) return auth.scopeOwn();
    return null;
  },
  ownPayslips(auth: AuthContext): RequestScope {
    requirePermission(auth, P.payslip.read.own);
    return auth.scopeOwn();
  },
  readAllPayslips: (auth: AuthContext) => requirePermission(auth, P.payslip.read.all),
};
