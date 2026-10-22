import { type DocumentCategory, P } from '@hrm/contracts';
import type { AuthContext } from '../../lib/auth-context';
import { requireFresh, requirePermission } from '../../lib/guards';
import { forbidden, notFound } from '../../lib/problem';

/**
 * What a caller may read (API-CATALOGUE §9, SECURITY-MODEL §4 and §8):
 * - `document.read.all`: every document, restricted ones included;
 * - `document.payroll.read`: the `payslip` category of every employee;
 * - `document.read.own`: the caller's own documents that are not flagged `is_restricted`;
 * - any session: company documents of the `policy` category that are not restricted.
 */
export interface DocumentReadAccess {
  all: boolean;
  payroll: boolean;
  ownEmployeeId: string | null;
}

export const documentsPolicy = {
  readAccess(auth: AuthContext): DocumentReadAccess {
    return {
      all: auth.can(P.document.read.all),
      payroll: auth.can(P.document.payroll.read),
      ownEmployeeId: auth.can(P.document.read.own) ? auth.employeeId : null,
    };
  },

  /** For `GET /employees/{id}/documents`: 403 without any document read permission, 404 outside scope. */
  listEmployeeDocuments(auth: AuthContext, employeeId: string): DocumentReadAccess {
    requirePermission(auth, P.document.read.all, P.document.read.own, P.document.payroll.read);
    const access = documentsPolicy.readAccess(auth);
    if (!access.all && !access.payroll && access.ownEmployeeId !== employeeId) throw notFound();
    return access;
  },

  /**
   * Uploads to an employee record need `document.manage`; an employee may upload a `receipt` for themselves with
   * `reimbursement.request.own` (API-CATALOGUE §9). Another employee's id is out of scope for them: 404.
   */
  upload(auth: AuthContext, employeeId: string, category: DocumentCategory, isRestricted: boolean) {
    if (auth.can(P.document.manage)) return;
    if (!auth.can(P.reimbursement.request.own)) throw forbidden();
    if (!auth.employeeId || employeeId !== auth.employeeId) throw notFound();
    if (category !== 'receipt' || isRestricted) throw forbidden();
  },

  manage: (auth: AuthContext) => requirePermission(auth, P.document.manage),

  /** Retention deletion: `document.manage` on a fresh session (API-CATALOGUE §9). */
  delete(auth: AuthContext, now: Date) {
    requirePermission(auth, P.document.manage);
    requireFresh(auth, now);
  },
};
