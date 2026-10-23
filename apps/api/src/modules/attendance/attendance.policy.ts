import { P } from '@hrm/contracts';
import type { RequestScope } from '@hrm/db';
import type { AuthContext } from '../../lib/auth-context';
import { requirePermission } from '../../lib/guards';
import { forbidden } from '../../lib/problem';

/** Authorization for attendance (SECURITY-MODEL §4). Out-of-scope records are reported as 404 by the service. */
export const attendancePolicy = {
  /** Check-in and check-out: the employee always comes from the session (FR-ATT-012). */
  punchEmployee(auth: AuthContext): string {
    requirePermission(auth, P.attendance.checkIn.own);
    if (!auth.employeeId) throw forbidden();
    return auth.employeeId;
  },

  ownEmployee(auth: AuthContext): string {
    requirePermission(auth, P.attendance.read.own);
    if (!auth.employeeId) throw forbidden();
    return auth.employeeId;
  },

  /** `GET /attendance`: all or team; the employee's own view is `/attendance/me`. */
  async listScope(auth: AuthContext): Promise<RequestScope> {
    if (auth.can(P.attendance.read.all)) return auth.scopeAll();
    if (auth.can(P.attendance.read.team)) return auth.scopeTeam();
    throw forbidden();
  },

  /** Summary: all, team, or own. */
  async summaryScope(auth: AuthContext): Promise<RequestScope> {
    if (auth.can(P.attendance.read.all)) return auth.scopeAll();
    if (auth.can(P.attendance.read.team)) return auth.scopeTeam();
    if (auth.can(P.attendance.read.own) && auth.employeeId) return auth.scopeOwn();
    throw forbidden();
  },

  /** By-id read of one employee's day: all, team, or own; false means 404. */
  async canReadEmployee(auth: AuthContext, employeeId: string): Promise<boolean> {
    if (auth.can(P.attendance.read.all)) return true;
    if (auth.can(P.attendance.read.own) && auth.employeeId === employeeId) return true;
    return auth.can(P.attendance.read.team) && (await auth.isInTeam(employeeId));
  },

  manage(auth: AuthContext) {
    requirePermission(auth, P.attendance.manage);
  },

  requestCorrection(auth: AuthContext): string {
    requirePermission(auth, P.attendance.correction.request.own);
    if (!auth.employeeId) throw forbidden();
    return auth.employeeId;
  },

  /** Corrections the caller may review: all (HR) or team (manager); null when neither. */
  async reviewScope(auth: AuthContext): Promise<RequestScope | null> {
    if (auth.can(P.attendance.correction.review.all)) return auth.scopeAll();
    if (auth.can(P.attendance.correction.review.team)) return auth.scopeTeam();
    return null;
  },

  /** Corrections list: the review scope plus the caller's own requests. */
  async correctionListScope(
    auth: AuthContext,
  ): Promise<{ review: RequestScope | null; ownEmployeeId: string | null }> {
    const review = await attendancePolicy.reviewScope(auth);
    const ownEmployeeId = auth.can(P.attendance.correction.request.own) ? auth.employeeId : null;
    if (!review && !ownEmployeeId) throw forbidden();
    return { review, ownEmployeeId };
  },

  reviewAllPermission: P.attendance.correction.review.all,
};
