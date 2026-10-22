import type {
  Company,
  CreateDepartmentInput,
  CreateHolidayInput,
  CreatePositionInput,
  CreateScheduleAssignmentInput,
  CreateWorkScheduleInput,
  Department,
  Holiday,
  Position,
  ScheduleAssignment,
  UpdateCompanyInput,
  UpdateDepartmentInput,
  UpdateHolidayInput,
  UpdatePositionInput,
  UpdateWorkScheduleInput,
  WorkSchedule,
} from '@hrm/contracts';
import { type schema, uuidv7 } from '@hrm/db';
import { toBusinessDate } from '@hrm/domain';
import { changes, recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import { withDbErrors } from '../../lib/db-errors';
import type { Deps } from '../../lib/deps';
import { defined, stamp } from '../../lib/dto';
import { notFound, ruleViolation, validationFailed, versionConflict } from '../../lib/problem';
import { organizationPolicy as policy } from './organization.policy';
import * as repo from './organization.repository';

type Row<T extends keyof typeof schema> = (typeof schema)[T] extends { $inferSelect: infer R } ? R : never;

const toCompany = (r: Row<'companies'>): Company => ({
  id: r.id,
  name: r.name,
  legalName: r.legalName,
  email: r.email,
  phone: r.phone,
  address: r.address,
  timezone: r.timezone,
  currency: r.currency,
  hasLogo: r.logoDocumentId !== null,
  ...stamp(r),
});

const toDepartment = (r: {
  department: Row<'departments'>;
  headEmployeeName: string | null;
}): Department => ({
  id: r.department.id,
  code: r.department.code,
  name: r.department.name,
  headEmployeeId: r.department.headEmployeeId,
  headEmployeeName: r.department.headEmployeeId ? r.headEmployeeName : null,
  isActive: r.department.isActive,
  ...stamp(r.department),
});

const toPosition = (r: Row<'positions'>): Position => ({
  id: r.id,
  title: r.title,
  departmentId: r.departmentId,
  grade: r.grade,
  isActive: r.isActive,
  ...stamp(r),
});

const toSchedule = (r: Row<'workSchedules'>): WorkSchedule => ({
  id: r.id,
  name: r.name,
  timezone: r.timezone,
  workingDays: [...r.workingDays].sort(),
  coreStart: r.coreStart.slice(0, 5),
  coreEnd: r.coreEnd.slice(0, 5),
  minDailyMinutes: r.minDailyMinutes,
  breakMinutes: r.breakMinutes,
  isDefault: r.isDefault,
  isActive: r.isActive,
  ...stamp(r),
});

const toHoliday = (r: Row<'holidays'>): Holiday => ({
  id: r.id,
  date: r.date,
  name: r.name,
  type: r.type,
  ...stamp(r),
});

const toAssignment = (r: Row<'scheduleAssignments'>): ScheduleAssignment => ({
  id: r.id,
  employeeId: r.employeeId,
  workScheduleId: r.workScheduleId,
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
  ...stamp(r),
});

const who = (auth: AuthContext, now: Date) => ({ updatedBy: auth.userId, updatedAt: now });

// Company -----------------------------------------------------------------------------------------------------------

export async function getCompany(deps: Deps, auth: AuthContext) {
  const row = await repo.findCompany(deps.db, auth.companyId);
  if (!row) throw notFound();
  return toCompany(row);
}

export async function updateCompany(deps: Deps, auth: AuthContext, input: UpdateCompanyInput) {
  policy.manageHrSettings(auth);
  const { version, ...fields } = input;
  return deps.db.transaction(async (tx) => {
    const before = await repo.findCompany(tx, auth.companyId);
    if (!before) throw notFound();
    const row = await repo.updateCompany(tx, auth.companyId, version, {
      ...defined(fields),
      ...who(auth, deps.clock.now()),
    });
    if (!row) throw versionConflict();
    await recordAudit(tx, auth.actor, {
      action: 'company.updated',
      category: 'business',
      entityType: 'company',
      entityId: row.id,
      metadata: { changes: changes(before, row, Object.keys(fields)) },
    });
    return toCompany(row);
  });
}

// Departments -------------------------------------------------------------------------------------------------------

const DEPARTMENT_CONSTRAINTS = {
  departments_code_uq: { code: 'DEPARTMENT_CODE_TAKEN', path: '/code' },
  departments_name_uq: { code: 'DUPLICATE', path: '/name' },
} as const;

async function assertEmployee(
  deps: Deps,
  auth: AuthContext,
  employeeId: string | null | undefined,
  path: string,
) {
  if (employeeId && !(await repo.employeeExists(deps.db, auth.companyId, employeeId))) {
    throw validationFailed([{ path, code: 'not_found', message: 'Employee not found.' }]);
  }
}

export async function listDepartments(deps: Deps, auth: AuthContext, includeInactive: boolean) {
  return (await repo.listDepartments(deps.db, auth.companyId, includeInactive)).map(toDepartment);
}

export async function createDepartment(deps: Deps, auth: AuthContext, input: CreateDepartmentInput) {
  policy.manageStructure(auth);
  await assertEmployee(deps, auth, input.headEmployeeId, '/headEmployeeId');
  const id = await deps.db.transaction(async (tx) => {
    const newId = await withDbErrors(
      () =>
        repo.insertDepartment(tx, {
          id: uuidv7(),
          companyId: auth.companyId,
          code: input.code,
          name: input.name,
          headEmployeeId: input.headEmployeeId ?? null,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        }),
      DEPARTMENT_CONSTRAINTS,
    );
    await recordAudit(tx, auth.actor, {
      action: 'department.created',
      category: 'business',
      entityType: 'department',
      entityId: newId,
      metadata: { code: input.code, name: input.name },
    });
    return newId;
  });
  return getDepartment(deps, auth, id);
}

export async function getDepartment(deps: Deps, auth: AuthContext, id: string) {
  const row = await repo.findDepartment(deps.db, auth.companyId, id);
  if (!row) throw notFound();
  return toDepartment(row);
}

export async function updateDepartment(
  deps: Deps,
  auth: AuthContext,
  id: string,
  input: UpdateDepartmentInput,
) {
  policy.manageStructure(auth);
  await assertEmployee(deps, auth, input.headEmployeeId, '/headEmployeeId');
  const { version, ...fields } = input;
  await deps.db.transaction(async (tx) => {
    const before = await repo.findDepartment(tx, auth.companyId, id);
    if (!before) throw notFound();
    const updated = await withDbErrors(
      () =>
        repo.updateDepartment(tx, auth.companyId, id, version, {
          ...defined(fields),
          ...who(auth, deps.clock.now()),
        }),
      DEPARTMENT_CONSTRAINTS,
    );
    if (!updated) throw versionConflict();
    await recordAudit(tx, auth.actor, {
      action: 'department.updated',
      category: 'business',
      entityType: 'department',
      entityId: id,
      metadata: {
        changes: changes(
          before.department,
          { ...before.department, ...defined(fields) },
          Object.keys(fields),
        ),
      },
    });
  });
  return getDepartment(deps, auth, id);
}

// Positions ---------------------------------------------------------------------------------------------------------

const POSITION_CONSTRAINTS = { positions_title_uq: { code: 'DUPLICATE', path: '/title' } } as const;

async function assertDepartment(deps: Deps, auth: AuthContext, departmentId: string | null | undefined) {
  if (departmentId && !(await repo.findDepartment(deps.db, auth.companyId, departmentId))) {
    throw validationFailed([{ path: '/departmentId', code: 'not_found', message: 'Department not found.' }]);
  }
}

export async function listPositions(deps: Deps, auth: AuthContext, includeInactive: boolean) {
  return (await repo.listPositions(deps.db, auth.companyId, includeInactive)).map(toPosition);
}

export async function createPosition(deps: Deps, auth: AuthContext, input: CreatePositionInput) {
  policy.manageStructure(auth);
  await assertDepartment(deps, auth, input.departmentId);
  return deps.db.transaction(async (tx) => {
    const row = await withDbErrors(
      () =>
        repo.insertPosition(tx, {
          id: uuidv7(),
          companyId: auth.companyId,
          title: input.title,
          departmentId: input.departmentId ?? null,
          grade: input.grade ?? null,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        }),
      POSITION_CONSTRAINTS,
    );
    if (!row) throw new Error('insert returned nothing');
    await recordAudit(tx, auth.actor, {
      action: 'position.created',
      category: 'business',
      entityType: 'position',
      entityId: row.id,
      metadata: { title: row.title },
    });
    return toPosition(row);
  });
}

export async function updatePosition(deps: Deps, auth: AuthContext, id: string, input: UpdatePositionInput) {
  policy.manageStructure(auth);
  await assertDepartment(deps, auth, input.departmentId);
  const { version, ...fields } = input;
  return deps.db.transaction(async (tx) => {
    const before = await repo.findPosition(tx, auth.companyId, id);
    if (!before) throw notFound();
    const row = await withDbErrors(
      () =>
        repo.updatePosition(tx, auth.companyId, id, version, {
          ...defined(fields),
          ...who(auth, deps.clock.now()),
        }),
      POSITION_CONSTRAINTS,
    );
    if (!row) throw versionConflict();
    await recordAudit(tx, auth.actor, {
      action: 'position.updated',
      category: 'business',
      entityType: 'position',
      entityId: id,
      metadata: { changes: changes(before, row, Object.keys(fields)) },
    });
    return toPosition(row);
  });
}

// Work schedules and assignments ------------------------------------------------------------------------------------

export async function listWorkSchedules(deps: Deps, auth: AuthContext) {
  policy.readSchedules(auth);
  return (await repo.listWorkSchedules(deps.db, auth.companyId)).map(toSchedule);
}

export async function createWorkSchedule(deps: Deps, auth: AuthContext, input: CreateWorkScheduleInput) {
  policy.manageSchedules(auth);
  return deps.db.transaction(async (tx) => {
    if (input.isDefault) await repo.clearDefaultSchedule(tx, auth.companyId);
    const row = await repo.insertWorkSchedule(tx, {
      id: uuidv7(),
      companyId: auth.companyId,
      name: input.name,
      workingDays: input.workingDays,
      coreStart: input.coreStart,
      coreEnd: input.coreEnd,
      minDailyMinutes: input.minDailyMinutes,
      breakMinutes: input.breakMinutes ?? 0,
      isDefault: input.isDefault ?? false,
      createdBy: auth.userId,
      updatedBy: auth.userId,
    });
    if (!row) throw new Error('insert returned nothing');
    await recordAudit(tx, auth.actor, {
      action: 'work_schedule.created',
      category: 'business',
      entityType: 'work_schedule',
      entityId: row.id,
      metadata: { name: row.name },
    });
    return toSchedule(row);
  });
}

/** Changing the core window does not rewrite closed days (API-CATALOGUE §3): closed records keep their status. */
export async function updateWorkSchedule(
  deps: Deps,
  auth: AuthContext,
  id: string,
  input: UpdateWorkScheduleInput,
) {
  policy.manageSchedules(auth);
  const { version, ...fields } = input;
  return deps.db.transaction(async (tx) => {
    const before = await repo.findWorkSchedule(tx, auth.companyId, id);
    if (!before) throw notFound();
    const coreStart = fields.coreStart ?? before.coreStart.slice(0, 5);
    const coreEnd = fields.coreEnd ?? before.coreEnd.slice(0, 5);
    if (coreEnd <= coreStart)
      throw validationFailed([
        { path: '/coreEnd', code: 'custom', message: 'Core end must be after core start.' },
      ]);
    if (fields.isActive === false && before.isDefault)
      throw ruleViolation('The default schedule cannot be deactivated.');
    if (fields.isDefault) await repo.clearDefaultSchedule(tx, auth.companyId);
    const row = await repo.updateWorkSchedule(tx, auth.companyId, id, version, {
      ...defined(fields),
      ...who(auth, deps.clock.now()),
    });
    if (!row) throw versionConflict();
    await recordAudit(tx, auth.actor, {
      action: 'work_schedule.updated',
      category: 'business',
      entityType: 'work_schedule',
      entityId: id,
      metadata: { changes: changes(toSchedule(before), toSchedule(row), Object.keys(fields)) },
    });
    return toSchedule(row);
  });
}

export async function createScheduleAssignment(
  deps: Deps,
  auth: AuthContext,
  input: CreateScheduleAssignmentInput,
) {
  policy.manageSchedules(auth);
  if (!(await repo.employeeExists(deps.db, auth.companyId, input.employeeId))) {
    throw validationFailed([{ path: '/employeeId', code: 'not_found', message: 'Employee not found.' }]);
  }
  const schedule = await repo.findWorkSchedule(deps.db, auth.companyId, input.workScheduleId);
  if (!schedule?.isActive)
    throw validationFailed([
      { path: '/workScheduleId', code: 'not_found', message: 'Active schedule not found.' },
    ]);
  return deps.db.transaction(async (tx) => {
    await repo.closeOpenAssignment(tx, auth.companyId, input.employeeId, input.effectiveFrom, auth.userId);
    const row = await withDbErrors(
      () =>
        repo.insertScheduleAssignment(tx, {
          id: uuidv7(),
          companyId: auth.companyId,
          employeeId: input.employeeId,
          workScheduleId: input.workScheduleId,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo ?? null,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        }),
      { schedule_assignments_no_overlap: { code: 'BUSINESS_RULE_VIOLATION' } },
    );
    if (!row) throw new Error('insert returned nothing');
    await recordAudit(tx, auth.actor, {
      action: 'schedule_assignment.created',
      category: 'business',
      entityType: 'schedule_assignment',
      entityId: row.id,
      employeeId: input.employeeId,
      metadata: {
        workScheduleId: input.workScheduleId,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
      },
    });
    return toAssignment(row);
  });
}

// Holidays ----------------------------------------------------------------------------------------------------------

const HOLIDAY_CONSTRAINTS = { holidays_date_uq: { code: 'DUPLICATE', path: '/date' } } as const;

export async function listHolidays(deps: Deps, auth: AuthContext, year?: number) {
  return (await repo.listHolidays(deps.db, auth.companyId, year)).map(toHoliday);
}

export async function createHoliday(deps: Deps, auth: AuthContext, input: CreateHolidayInput) {
  policy.manageHrSettings(auth);
  return deps.db.transaction(async (tx) => {
    const row = await withDbErrors(
      () =>
        repo.insertHoliday(tx, {
          id: uuidv7(),
          companyId: auth.companyId,
          date: input.date,
          name: input.name,
          type: input.type ?? 'public',
          createdBy: auth.userId,
          updatedBy: auth.userId,
        }),
      HOLIDAY_CONSTRAINTS,
    );
    if (!row) throw new Error('insert returned nothing');
    await recordAudit(tx, auth.actor, {
      action: 'holiday.created',
      category: 'business',
      entityType: 'holiday',
      entityId: row.id,
      metadata: { date: row.date, name: row.name },
    });
    return toHoliday(row);
  });
}

export async function updateHoliday(deps: Deps, auth: AuthContext, id: string, input: UpdateHolidayInput) {
  policy.manageHrSettings(auth);
  const { version, ...fields } = input;
  return deps.db.transaction(async (tx) => {
    const before = await repo.findHoliday(tx, auth.companyId, id);
    if (!before) throw notFound();
    const row = await repo.updateHoliday(tx, auth.companyId, id, version, {
      ...defined(fields),
      ...who(auth, deps.clock.now()),
    });
    if (!row) throw versionConflict();
    await recordAudit(tx, auth.actor, {
      action: 'holiday.updated',
      category: 'business',
      entityType: 'holiday',
      entityId: id,
      metadata: { changes: changes(before, row, Object.keys(fields)) },
    });
    return toHoliday(row);
  });
}

/** Only future holidays can be deleted: past ones already shaped attendance and leave (API-CATALOGUE §3). */
export async function deleteHoliday(deps: Deps, auth: AuthContext, id: string) {
  policy.manageHrSettings(auth);
  await deps.db.transaction(async (tx) => {
    const before = await repo.findHoliday(tx, auth.companyId, id);
    if (!before) throw notFound();
    if (before.date <= toBusinessDate(deps.clock.now()))
      throw ruleViolation('Only future holidays can be deleted.');
    await repo.deleteHoliday(tx, auth.companyId, id);
    await recordAudit(tx, auth.actor, {
      action: 'holiday.deleted',
      category: 'business',
      entityType: 'holiday',
      entityId: id,
      metadata: { date: before.date, name: before.name },
    });
  });
}
