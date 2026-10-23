// Canonical permission catalogue and default role grants.
// Source of truth: docs/03-architecture/SECURITY-MODEL.md §2 and §4 (a test keeps them in sync).

/** Permission codenames, grouped for `P.leave.request.review.team` style access (CODING-STANDARDS §2). */
export const P = {
  user: { manage: 'user.manage' },
  role: { manage: 'role.manage' },
  settings: {
    technical: { manage: 'settings.technical.manage' },
    hr: { manage: 'settings.hr.manage' },
    payroll: { manage: 'settings.payroll.manage' },
    read: 'settings.read',
  },
  org: { manage: 'org.manage' },
  employee: {
    read: { all: 'employee.read.all', team: 'employee.read.team', own: 'employee.read.own' },
    manage: 'employee.manage',
    contact: { read: { all: 'employee.contact.read.all' } },
  },
  profileChange: {
    request: { own: 'profile_change.request.own' },
    review: { all: 'profile_change.review.all' },
  },
  compensation: {
    read: { all: 'compensation.read.all', own: 'compensation.read.own' },
    manage: 'compensation.manage',
  },
  payroll: {
    read: { all: 'payroll.read.all' },
    prepare: 'payroll.prepare',
    approve: 'payroll.approve',
    lock: 'payroll.lock',
    pay: 'payroll.pay',
  },
  payslip: { read: { all: 'payslip.read.all', own: 'payslip.read.own' } },
  attendance: {
    checkIn: { own: 'attendance.check_in.own' },
    read: { all: 'attendance.read.all', team: 'attendance.read.team', own: 'attendance.read.own' },
    manage: 'attendance.manage',
    correction: {
      request: { own: 'attendance.correction.request.own' },
      review: { team: 'attendance.correction.review.team', all: 'attendance.correction.review.all' },
    },
  },
  leave: {
    policy: { manage: 'leave.policy.manage' },
    read: { all: 'leave.read.all', team: 'leave.read.team' },
    request: {
      own: 'leave.request.own',
      review: { team: 'leave.request.review.team', all: 'leave.request.review.all' },
    },
    balance: { adjust: 'leave.balance.adjust' },
  },
  reimbursement: {
    request: { own: 'reimbursement.request.own' },
    review: { team: 'reimbursement.review.team', all: 'reimbursement.review.all' },
    read: { all: 'reimbursement.read.all' },
  },
  document: {
    read: { own: 'document.read.own', all: 'document.read.all' },
    manage: 'document.manage',
    payroll: { read: 'document.payroll.read' },
  },
  approval: { inbox: 'approval.inbox' },
  report: { hr: 'report.hr', payroll: 'report.payroll', team: 'report.team' },
  audit: {
    read: { all: 'audit.read.all', payroll: 'audit.read.payroll', technical: 'audit.read.technical' },
  },
  system: { health: { read: 'system.health.read' } },
} as const;

type Leaves<T> = T extends string ? T : { [K in keyof T]: Leaves<T[K]> }[keyof T];
export type Permission = Leaves<typeof P>;

function collect(node: unknown, out: string[]): string[] {
  if (typeof node === 'string') out.push(node);
  else if (node && typeof node === 'object') for (const v of Object.values(node)) collect(v, out);
  return out;
}

/** Every permission codename, in catalogue order. */
export const PERMISSIONS = collect(P, []) as Permission[];

export const ROLE_CODES = [
  'system_admin',
  'hr_admin',
  'payroll_officer',
  'director',
  'auditor',
  'manager',
  'employee',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

/** Roles derived from data, never stored in user_roles (SECURITY-MODEL §2). */
export const DERIVED_ROLES = ['manager', 'employee'] as const satisfies readonly RoleCode[];
export type AssignableRoleCode = Exclude<RoleCode, (typeof DERIVED_ROLES)[number]>;
export const ASSIGNABLE_ROLES = ROLE_CODES.filter(
  (r): r is AssignableRoleCode => !(DERIVED_ROLES as readonly string[]).includes(r),
);

export interface RoleDefinition {
  code: RoleCode;
  name: string;
  description: string;
  isDerived: boolean;
  requiresStrongAuth: boolean;
  permissions: readonly Permission[];
}

/** Default roles and grants (seed data; editable later through `role.manage`). */
export const DEFAULT_ROLES: readonly RoleDefinition[] = [
  {
    code: 'system_admin',
    name: 'System admin',
    description: 'Technical administration. No business data by default.',
    isDerived: false,
    requiresStrongAuth: true,
    permissions: [
      P.user.manage,
      P.role.manage,
      P.settings.technical.manage,
      P.settings.read,
      P.audit.read.technical,
      P.system.health.read,
    ],
  },
  {
    code: 'hr_admin',
    name: 'HR admin',
    description: 'Employees, organization, leave and attendance administration.',
    isDerived: false,
    requiresStrongAuth: true,
    permissions: [
      P.user.manage,
      P.settings.hr.manage,
      P.settings.read,
      P.org.manage,
      P.employee.read.all,
      P.employee.manage,
      P.employee.contact.read.all,
      P.profileChange.review.all,
      P.compensation.read.all,
      P.attendance.read.all,
      P.attendance.manage,
      P.attendance.correction.review.all,
      P.leave.policy.manage,
      P.leave.read.all,
      P.leave.request.review.all,
      P.leave.balance.adjust,
      P.reimbursement.review.all,
      P.reimbursement.read.all,
      P.document.read.all,
      P.document.manage,
      P.approval.inbox,
      P.report.hr,
      P.audit.read.all,
    ],
  },
  {
    code: 'payroll_officer',
    name: 'Payroll officer',
    description: 'Salary structures, payroll runs, payments and payslips.',
    isDerived: false,
    requiresStrongAuth: true,
    permissions: [
      P.settings.payroll.manage,
      P.settings.read,
      P.employee.read.all,
      P.compensation.read.all,
      P.compensation.manage,
      P.payroll.read.all,
      P.payroll.prepare,
      P.payroll.approve,
      P.payroll.lock,
      P.payroll.pay,
      P.payslip.read.all,
      P.attendance.read.all,
      P.reimbursement.review.all,
      P.reimbursement.read.all,
      P.document.payroll.read,
      P.approval.inbox,
      P.report.payroll,
      P.audit.read.payroll,
    ],
  },
  {
    code: 'director',
    name: 'Director',
    description: 'Top management: reads all data including compensation; approves payroll (D-008).',
    isDerived: false,
    requiresStrongAuth: true,
    permissions: [
      P.settings.read,
      P.employee.read.all,
      P.compensation.read.all,
      P.payroll.read.all,
      P.payroll.approve,
      P.payslip.read.all,
      P.attendance.read.all,
      P.leave.read.all,
      P.reimbursement.read.all,
      P.document.payroll.read,
      P.approval.inbox,
      P.report.hr,
      P.report.payroll,
      P.audit.read.all,
    ],
  },
  {
    code: 'auditor',
    name: 'Auditor',
    description: 'Read-only reviewer, including compensation and payroll.',
    isDerived: false,
    requiresStrongAuth: true,
    permissions: [
      P.settings.read,
      P.employee.read.all,
      P.compensation.read.all,
      P.payroll.read.all,
      P.payslip.read.all,
      P.attendance.read.all,
      P.leave.read.all,
      P.reimbursement.read.all,
      P.document.payroll.read,
      P.report.hr,
      P.report.payroll,
      P.audit.read.all,
    ],
  },
  {
    code: 'manager',
    name: 'Manager',
    description: 'Anyone with direct reports (derived from the reporting line).',
    isDerived: true,
    requiresStrongAuth: false,
    permissions: [
      P.employee.read.team,
      P.attendance.read.team,
      P.attendance.correction.review.team,
      P.leave.read.team,
      P.leave.request.review.team,
      P.reimbursement.review.team,
      P.approval.inbox,
      P.report.team,
    ],
  },
  {
    code: 'employee',
    name: 'Employee',
    description: 'Anyone with a linked employee record (derived).',
    isDerived: true,
    requiresStrongAuth: false,
    permissions: [
      P.employee.read.own,
      P.profileChange.request.own,
      P.compensation.read.own,
      P.payslip.read.own,
      P.attendance.checkIn.own,
      P.attendance.read.own,
      P.attendance.correction.request.own,
      P.leave.request.own,
      P.reimbursement.request.own,
      P.document.read.own,
    ],
  },
];

/**
 * Permissions a role without strong auth may hold: the default grants of the derived `manager` and `employee` roles.
 * Anything else (payroll, compensation, audit, administration) needs a role that requires strong auth (D-049, C11).
 */
export const WEAK_ROLE_PERMISSIONS: ReadonlySet<string> = new Set<string>(
  DEFAULT_ROLES.filter((r) => !r.requiresStrongAuth).flatMap((r) => r.permissions),
);

/** Roles that require a strong session (passkey, or email code + TOTP); D-006, D-033. */
export const STRONG_AUTH_ROLES = DEFAULT_ROLES.filter((r) => r.requiresStrongAuth).map((r) => r.code);

const RESOURCE_LABEL: Record<string, string> = {
  user: 'users',
  role: 'roles',
  settings: 'settings',
  org: 'departments and positions',
  employee: 'employees',
  profile_change: 'profile changes',
  compensation: 'salary structures',
  payroll: 'payroll',
  payslip: 'payslips',
  attendance: 'attendance',
  leave: 'leave',
  reimbursement: 'claims',
  document: 'documents',
  approval: 'approvals',
  report: 'reports',
  audit: 'audit log',
  system: 'system health',
};
const SCOPE_LABEL: Record<string, string> = { all: 'all employees', team: 'own team', own: 'own records' };

/** A readable description of a permission code, for the roles screen and the permissions table. */
export function describePermission(code: string): string {
  const parts = code.split('.');
  const resource = RESOURCE_LABEL[parts[0] ?? ''] ?? parts[0] ?? code;
  const last = parts.at(-1) ?? '';
  const scope = SCOPE_LABEL[last];
  const verbs = parts.slice(1, scope ? -1 : undefined).map((p) => p.replaceAll('_', ' '));
  const action = verbs.length ? verbs.join(' ') : 'access';
  return `${action.charAt(0).toUpperCase()}${action.slice(1)} ${resource}${scope ? ` (${scope})` : ''}`;
}
