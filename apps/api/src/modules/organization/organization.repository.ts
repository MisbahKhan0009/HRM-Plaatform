import { type Queryable, schema, type Tx } from '@hrm/db';
import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm';

const { companies, departments, positions, workSchedules, holidays, scheduleAssignments, employees } = schema;

const bump = <T extends { version: unknown }>(t: T) => sql`${t.version} + 1`;

export async function findCompany(db: Queryable, companyId: string) {
  const [row] = await db.select().from(companies).where(eq(companies.id, companyId));
  return row ?? null;
}

export async function updateCompany(
  tx: Tx,
  companyId: string,
  version: number,
  values: Partial<typeof companies.$inferInsert>,
) {
  const [row] = await tx
    .update(companies)
    .set({ ...values, version: bump(companies) })
    .where(and(eq(companies.id, companyId), eq(companies.version, version)))
    .returning();
  return row ?? null;
}

const departmentColumns = {
  department: departments,
  headEmployeeName: sql<
    string | null
  >`coalesce(${employees.preferredName}, ${employees.firstName}) || ' ' || ${employees.lastName}`,
};

export function listDepartments(db: Queryable, companyId: string, includeInactive: boolean) {
  return db
    .select(departmentColumns)
    .from(departments)
    .leftJoin(employees, eq(employees.id, departments.headEmployeeId))
    .where(
      and(eq(departments.companyId, companyId), includeInactive ? undefined : eq(departments.isActive, true)),
    )
    .orderBy(asc(departments.name))
    .limit(500);
}

export async function findDepartment(db: Queryable, companyId: string, id: string) {
  const [row] = await db
    .select(departmentColumns)
    .from(departments)
    .leftJoin(employees, eq(employees.id, departments.headEmployeeId))
    .where(and(eq(departments.companyId, companyId), eq(departments.id, id)));
  return row ?? null;
}

export async function insertDepartment(tx: Tx, values: typeof departments.$inferInsert) {
  const [row] = await tx.insert(departments).values(values).returning({ id: departments.id });
  return row?.id as string;
}

export async function updateDepartment(
  tx: Tx,
  companyId: string,
  id: string,
  version: number,
  values: Partial<typeof departments.$inferInsert>,
) {
  const [row] = await tx
    .update(departments)
    .set({ ...values, version: bump(departments) })
    .where(
      and(eq(departments.companyId, companyId), eq(departments.id, id), eq(departments.version, version)),
    )
    .returning({ id: departments.id });
  return row?.id ?? null;
}

export function listPositions(db: Queryable, companyId: string, includeInactive: boolean) {
  return db
    .select()
    .from(positions)
    .where(
      and(eq(positions.companyId, companyId), includeInactive ? undefined : eq(positions.isActive, true)),
    )
    .orderBy(asc(positions.title))
    .limit(500);
}

export async function findPosition(db: Queryable, companyId: string, id: string) {
  const [row] = await db
    .select()
    .from(positions)
    .where(and(eq(positions.companyId, companyId), eq(positions.id, id)));
  return row ?? null;
}

export async function insertPosition(tx: Tx, values: typeof positions.$inferInsert) {
  const [row] = await tx.insert(positions).values(values).returning();
  return row;
}

export async function updatePosition(
  tx: Tx,
  companyId: string,
  id: string,
  version: number,
  values: Partial<typeof positions.$inferInsert>,
) {
  const [row] = await tx
    .update(positions)
    .set({ ...values, version: bump(positions) })
    .where(and(eq(positions.companyId, companyId), eq(positions.id, id), eq(positions.version, version)))
    .returning();
  return row ?? null;
}

export function listWorkSchedules(db: Queryable, companyId: string) {
  return db
    .select()
    .from(workSchedules)
    .where(eq(workSchedules.companyId, companyId))
    .orderBy(asc(workSchedules.name))
    .limit(100);
}

export async function findWorkSchedule(db: Queryable, companyId: string, id: string) {
  const [row] = await db
    .select()
    .from(workSchedules)
    .where(and(eq(workSchedules.companyId, companyId), eq(workSchedules.id, id)));
  return row ?? null;
}

export async function clearDefaultSchedule(tx: Tx, companyId: string) {
  await tx
    .update(workSchedules)
    .set({ isDefault: false })
    .where(and(eq(workSchedules.companyId, companyId), eq(workSchedules.isDefault, true)));
}

export async function insertWorkSchedule(tx: Tx, values: typeof workSchedules.$inferInsert) {
  const [row] = await tx.insert(workSchedules).values(values).returning();
  return row;
}

export async function updateWorkSchedule(
  tx: Tx,
  companyId: string,
  id: string,
  version: number,
  values: Partial<typeof workSchedules.$inferInsert>,
) {
  const [row] = await tx
    .update(workSchedules)
    .set({ ...values, version: bump(workSchedules) })
    .where(
      and(
        eq(workSchedules.companyId, companyId),
        eq(workSchedules.id, id),
        eq(workSchedules.version, version),
      ),
    )
    .returning();
  return row ?? null;
}

export async function employeeExists(db: Queryable, companyId: string, id: string) {
  const [row] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.id, id)));
  return Boolean(row);
}

/** Ends the employee's open-ended assignment the day before a new one starts. */
export async function closeOpenAssignment(
  tx: Tx,
  companyId: string,
  employeeId: string,
  from: string,
  by: string,
) {
  await tx
    .update(scheduleAssignments)
    .set({
      effectiveTo: sql`${from}::date - 1`,
      updatedBy: by,
      updatedAt: sql`now()`,
      version: bump(scheduleAssignments),
    })
    .where(
      and(
        eq(scheduleAssignments.companyId, companyId),
        eq(scheduleAssignments.employeeId, employeeId),
        isNull(scheduleAssignments.effectiveTo),
        lt(scheduleAssignments.effectiveFrom, from),
      ),
    );
}

export async function insertScheduleAssignment(tx: Tx, values: typeof scheduleAssignments.$inferInsert) {
  const [row] = await tx.insert(scheduleAssignments).values(values).returning();
  return row;
}

export function listHolidays(db: Queryable, companyId: string, year?: number) {
  return db
    .select()
    .from(holidays)
    .where(
      and(
        eq(holidays.companyId, companyId),
        year ? sql`${holidays.date} BETWEEN ${`${year}-01-01`} AND ${`${year}-12-31`}` : undefined,
      ),
    )
    .orderBy(asc(holidays.date))
    .limit(366);
}

export async function findHoliday(db: Queryable, companyId: string, id: string) {
  const [row] = await db
    .select()
    .from(holidays)
    .where(and(eq(holidays.companyId, companyId), eq(holidays.id, id)));
  return row ?? null;
}

export async function insertHoliday(tx: Tx, values: typeof holidays.$inferInsert) {
  const [row] = await tx.insert(holidays).values(values).returning();
  return row;
}

export async function updateHoliday(
  tx: Tx,
  companyId: string,
  id: string,
  version: number,
  values: Partial<typeof holidays.$inferInsert>,
) {
  const [row] = await tx
    .update(holidays)
    .set({ ...values, version: bump(holidays) })
    .where(and(eq(holidays.companyId, companyId), eq(holidays.id, id), eq(holidays.version, version)))
    .returning();
  return row ?? null;
}

export async function deleteHoliday(tx: Tx, companyId: string, id: string) {
  await tx.delete(holidays).where(and(eq(holidays.companyId, companyId), eq(holidays.id, id)));
}
