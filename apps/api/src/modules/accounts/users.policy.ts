import { P } from '@hrm/contracts';
import type { AuthContext } from '../../lib/auth-context';
import { requirePermission } from '../../lib/guards';
import { AppError } from '../../lib/problem';

/** Authorization for user administration (SECURITY-MODEL §4, API-CATALOGUE §2). */
export const usersPolicy = {
  manageUsers: (auth: AuthContext) => requirePermission(auth, P.user.manage),
  manageRoles: (auth: AuthContext) => requirePermission(auth, P.role.manage),
  readRoles: (auth: AuthContext) => requirePermission(auth, P.role.manage, P.settings.read),
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
