import type { Permission } from '@hrm/contracts';
import type { AuthContext } from './auth-context';
import { AppError, forbidden } from './problem';

/** Requires one of the permissions; for list and create endpoints (by-id endpoints use scopes and 404). */
export function requirePermission(auth: AuthContext, ...permissions: Permission[]) {
  if (!auth.canAny(...permissions)) throw forbidden();
}

/** "Strong" in API-CATALOGUE: a passkey or TOTP-verified session. */
export function requireStrong(auth: AuthContext) {
  if (!auth.strongAuth) throw new AppError('MFA_REQUIRED', 'Verification required');
}

/** "Fresh" in API-CATALOGUE: strong auth within the last 15 minutes (SECURITY-MODEL §7). */
export function requireFresh(auth: AuthContext, now: Date) {
  if (!auth.isFresh(now))
    throw new AppError('REAUTH_REQUIRED', 'Confirm it is you', 'Verify again to continue.');
}
