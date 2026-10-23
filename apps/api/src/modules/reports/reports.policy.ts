import { P, type Permission, type ReportName } from '@hrm/contracts';
import type { RequestScope } from '@hrm/db';
import type { AuthContext } from '../../lib/auth-context';
import { requirePermission } from '../../lib/guards';

/** Permissions that open each report (API-CATALOGUE §12, SECURITY-MODEL §4). */
const REPORT_PERMISSIONS: Record<ReportName, readonly Permission[]> = {
  headcount: [P.report.hr],
  directory: [P.report.hr, P.report.team],
  attendance: [P.report.hr, P.report.team],
  leave: [P.report.hr, P.report.team],
  payroll_register: [P.report.payroll],
  payroll_deductions: [P.report.payroll],
  payment_reconciliation: [P.report.payroll],
  reimbursements: [P.report.payroll, P.report.hr],
};

/** Payroll reports are audited in the payroll category (AUDIT.md §3: `report.exported` is business / payroll). */
export const PAYROLL_REPORTS: readonly ReportName[] = [
  'payroll_register',
  'payroll_deductions',
  'payment_reconciliation',
];

export const reportsPolicy = {
  require(auth: AuthContext, report: ReportName) {
    requirePermission(auth, ...REPORT_PERMISSIONS[report]);
  },

  /**
   * Employee scope for reports open to `report.hr` and `report.team` (FR-REP-006): every employee with `report.hr`,
   * otherwise the caller's direct and indirect reports.
   */
  async employeeScope(auth: AuthContext, report: ReportName): Promise<RequestScope> {
    reportsPolicy.require(auth, report);
    return auth.can(P.report.hr) ? auth.scopeAll() : auth.scopeTeam();
  },
};
