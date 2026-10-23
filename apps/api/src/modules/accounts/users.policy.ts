import { P } from '@hrm/contracts';
import type { AuthContext } from '../../lib/auth-context';
import { requirePermission } from '../../lib/guards';
import { AppError } from '../../lib/problem';

/** Authorization for user administration (SECURITY-MODEL §4, API-CATALOGUE §2). */
export const usersPolicy = {
  manageUsers: (auth: AuthContext) => requirePermission(auth, P.user.manage),
  manageRoles: (auth: AuthContext) => requirePermission(auth, P.role.manage),
  readRoles: (auth: AuthContext) => requirePermission(auth, P.role.manage, P.settings.read),
  /**
   * Account actions (suspend, reactivate, deactivate, reset sign-in) on a system admin need `role.manage`, so an HR
   * admin holding only `user.manage` cannot lock out or take over the system admin; the system admin can act on HR
   * admins (owner decision C13).
   */
  actOnAccount: (auth: AuthContext, targetRoles: readonly string[]) => {
    if (targetRoles.includes('system_admin') && !auth.can(P.role.manage))
      throw new AppError(
        'FORBIDDEN',
        'Not allowed',
        'Only a system admin can change a system admin account.',
      );
  },
  /** Users cannot suspend, deactivate, reset or change the roles of their own account (API-CATALOGUE §2). */
  notSelf: (auth: AuthContext, userId: string) => {
    if (userId === auth.userId)
      throw new AppError(
        'SELF_APPROVAL_FORBIDDEN',
        'Not allowed on your own account',
        'Ask another administrator to do this.',
      );
  },
};
