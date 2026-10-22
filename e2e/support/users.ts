/** Seeded journey users (fake data only; D-043 public repository). */
export const E2E_USERS = [
  {
    key: 'manager',
    email: 'manager@example.test',
    name: 'Mina Manager',
    roles: [],
    employeeCode: 'EMP-0001',
    managerKey: null,
  },
  {
    key: 'employee',
    email: 'employee@example.test',
    name: 'Eman Employee',
    roles: [],
    employeeCode: 'EMP-0002',
    managerKey: 'manager',
  },
  {
    key: 'employee2',
    email: 'employee2@example.test',
    name: 'Bilal Second',
    roles: [],
    employeeCode: 'EMP-0003',
    managerKey: 'manager',
  },
  {
    key: 'hr',
    email: 'hr@example.test',
    name: 'Hasina HR',
    roles: ['hr_admin'],
    employeeCode: 'EMP-0004',
    managerKey: null,
  },
  {
    key: 'payroll',
    email: 'payroll@example.test',
    name: 'Parvez Payroll',
    roles: ['payroll_officer'],
    employeeCode: 'EMP-0005',
    managerKey: null,
  },
] as const;

export type E2EUserKey = (typeof E2E_USERS)[number]['key'];
export const userEmail = (key: E2EUserKey) => E2E_USERS.find((u) => u.key === key)?.email as string;
