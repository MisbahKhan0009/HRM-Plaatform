/**
 * Better Auth configuration (ADR-0004, D-033): passkeys + email OTP, TOTP for privileged roles,
 * no passwords. The configuration is written after the Stage 7 spike confirms the plugins fit the
 * Workers Free CPU budget (docs/05-backend/AUTH-IMPLEMENTATION.md §10).
 */

/** Roles that must hold a strong session (D-006, SECURITY-MODEL §2). */
export const STRONG_AUTH_ROLES = [
  'system_admin',
  'hr_admin',
  'payroll_officer',
  'director',
  'auditor',
] as const;
export type StrongAuthRole = (typeof STRONG_AUTH_ROLES)[number];

export function requiresStrongAuth(roles: readonly string[]): boolean {
  return roles.some((r) => (STRONG_AUTH_ROLES as readonly string[]).includes(r));
}
