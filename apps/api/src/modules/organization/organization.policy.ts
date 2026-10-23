import { P } from '@hrm/contracts';
import type { AuthContext } from '../../lib/auth-context';
import { requirePermission } from '../../lib/guards';

/** Authorization for organization configuration (SECURITY-MODEL §4). Reads of org structure are open to any session. */
export const organizationPolicy = {
  manageStructure: (auth: AuthContext) => requirePermission(auth, P.org.manage),
  manageHrSettings: (auth: AuthContext) => requirePermission(auth, P.settings.hr.manage),
  readSchedules: (auth: AuthContext) =>
    requirePermission(
      auth,
      P.attendance.read.all,
      P.attendance.read.team,
      P.attendance.read.own,
      P.attendance.manage,
    ),
  manageSchedules: (auth: AuthContext) => requirePermission(auth, P.attendance.manage),
};
