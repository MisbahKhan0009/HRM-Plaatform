import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './client';
import { uuidv7 } from './ids';
import { departments, employees, positions, roles, salaryStructures, userRoles, users } from './schema';

// Synthetic people for staging and local demos only. Never run against production (DEPLOYMENT.md §3).
const PEOPLE = [
  {
    first: 'Ayesha',
    last: 'Rahman',
    dept: 'ENG',
    title: 'Engineering Manager',
    role: null,
    manager: null,
    gross: '180000.00',
  },
  {
    first: 'Tanvir',
    last: 'Hossain',
    dept: 'ENG',
    title: 'Software Engineer',
    role: null,
    manager: 0,
    gross: '95000.00',
  },
  {
    first: 'Nusrat',
    last: 'Jahan',
    dept: 'ENG',
    title: 'Software Engineer',
    role: null,
    manager: 0,
    gross: '90000.00',
  },
  {
    first: 'Rafiq',
    last: 'Islam',
    dept: 'ENG',
    title: 'QA Engineer',
    role: null,
    manager: 0,
    gross: '70000.00',
  },
  {
    first: 'Farzana',
    last: 'Akter',
    dept: 'HR',
    title: 'HR Officer',
    role: 'hr_admin',
    manager: null,
    gross: '85000.00',
  },
  {
    first: 'Imran',
    last: 'Chowdhury',
    dept: 'FIN',
    title: 'Accountant',
    role: 'payroll_officer',
    manager: null,
    gross: '88000.00',
  },
  {
    first: 'Sadia',
    last: 'Karim',
    dept: 'OPS',
    title: 'Operations Lead',
    role: null,
    manager: null,
    gross: '120000.00',
  },
  {
    first: 'Mahmud',
    last: 'Hasan',
    dept: 'OPS',
    title: 'Support Specialist',
    role: null,
    manager: 6,
    gross: '55000.00',
  },
  {
    first: 'Shirin',
    last: 'Sultana',
    dept: 'OPS',
    title: 'Support Specialist',
    role: null,
    manager: 6,
    gross: '52000.00',
  },
  {
    first: 'Kamal',
    last: 'Uddin',
    dept: 'MGT',
    title: 'Director',
    role: 'director',
    manager: null,
    gross: '250000.00',
  },
] as const;

const DEPARTMENTS = [
  ['ENG', 'Engineering'],
  ['HR', 'Human Resources'],
  ['FIN', 'Finance'],
  ['OPS', 'Operations'],
  ['MGT', 'Management'],
] as const;

/** Adds demo departments, positions, employees with sign-in users (`<first>@demo.example`) and approved salaries. */
export async function seedDemo(db: Db, companyId: string, emailDomain = 'demo.example') {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(employees)
      .where(eq(employees.companyId, companyId));
    if ((existing?.n ?? 0) > 0) return { skipped: true as const };

    const deptIds = new Map<string, string>();
    for (const [code, name] of DEPARTMENTS) {
      await tx.insert(departments).values({ id: uuidv7(), companyId, code, name }).onConflictDoNothing();
      const [dept] = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(and(eq(departments.companyId, companyId), eq(departments.code, code)));
      if (dept) deptIds.set(code, dept.id);
    }
    const roleIds = new Map(
      (
        await tx.select({ id: roles.id, code: roles.code }).from(roles).where(eq(roles.companyId, companyId))
      ).map((r) => [r.code, r.id]),
    );
    const employeeIds: string[] = [];
    for (const [i, p] of PEOPLE.entries()) {
      const positionId = uuidv7();
      await tx
        .insert(positions)
        .values({ id: positionId, companyId, title: p.title, departmentId: deptIds.get(p.dept) ?? null })
        .onConflictDoNothing();
      const [pos] = await tx
        .select({ id: positions.id })
        .from(positions)
        .where(
          and(
            eq(positions.companyId, companyId),
            eq(positions.title, p.title),
            eq(positions.departmentId, deptIds.get(p.dept) as string),
          ),
        );
      const userId = uuidv7();
      const email = `${p.first.toLowerCase()}@${emailDomain}`;
      await tx.insert(users).values({
        id: userId,
        companyId,
        email,
        name: `${p.first} ${p.last}`,
        emailVerified: true,
        status: 'active',
      });
      if (p.role) await tx.insert(userRoles).values({ userId, roleId: roleIds.get(p.role) as string });
      const employeeId = uuidv7();
      await tx.insert(employees).values({
        id: employeeId,
        companyId,
        userId,
        employeeCode: `EMP-${String(i + 1).padStart(4, '0')}`,
        firstName: p.first,
        lastName: p.last,
        workEmail: email,
        status: 'active',
        departmentId: deptIds.get(p.dept) ?? null,
        positionId: pos?.id ?? null,
        managerId: p.manager === null ? null : (employeeIds[p.manager] ?? null),
        joiningDate: '2025-01-01',
      });
      employeeIds.push(employeeId);
      await tx.insert(salaryStructures).values({
        id: uuidv7(),
        companyId,
        employeeId,
        grossAmount: p.gross,
        effectiveFrom: '2025-01-01',
        status: 'approved',
        reason: 'Demo data',
        approvedAt: new Date(),
      });
    }
    // Employee codes continue after the demo people.
    await tx.execute(
      sql`UPDATE code_sequences SET next_value = ${PEOPLE.length + 1} WHERE company_id = ${companyId} AND scope = 'employee'`,
    );
    return { skipped: false as const, employees: PEOPLE.length };
  });
}
