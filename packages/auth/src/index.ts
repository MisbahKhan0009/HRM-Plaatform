export { type Auth, type AuthConfig, createAuth } from './create-auth';

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
