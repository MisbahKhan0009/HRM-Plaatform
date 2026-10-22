import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  integer,
  pgTable,
  smallint,
  text,
  time,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyColumn, standardColumns } from './columns';
import { holidayType } from './enums';

// DATA-MODEL.md §3. departments.head_employee_id gets its FK in the constraints migration (cross-file cycle).
export const departments = pgTable(
  'departments',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    code: text().notNull(),
    name: text().notNull(),
    headEmployeeId: uuid(),
    isActive: boolean().notNull().default(true),
    ...standardColumns(),
  },
  (t) => [
    unique('departments_code_uq').on(t.companyId, t.code),
    uniqueIndex('departments_name_uq').on(t.companyId, sql`lower(${t.name})`),
    check('departments_code_fmt', sql`${t.code} ~ '^[A-Z0-9-]{2,20}$'`),
  ],
);

export const positions = pgTable(
  'positions',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    departmentId: uuid().references(() => departments.id, { onDelete: 'restrict' }),
    title: text().notNull(),
    grade: text(),
    isActive: boolean().notNull().default(true),
    ...standardColumns(),
  },
  (t) => [
    uniqueIndex('positions_title_uq').on(
      t.companyId,
      sql`coalesce(${t.departmentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`lower(${t.title})`,
    ),
  ],
);

export const workSchedules = pgTable(
  'work_schedules',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    name: text().notNull(),
    timezone: text().notNull().default('Asia/Dhaka'),
    workingDays: smallint().array().notNull().default(sql`'{0,1,2,3,4}'`),
    coreStart: time().notNull(),
    coreEnd: time().notNull(),
    minDailyMinutes: integer().notNull(),
    breakMinutes: integer().notNull().default(0),
    isDefault: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    ...standardColumns(),
  },
  (t) => [
    check('work_schedules_core', sql`${t.coreEnd} > ${t.coreStart}`),
    check('work_schedules_min', sql`${t.minDailyMinutes} BETWEEN 0 AND 1440`),
    check('work_schedules_break', sql`${t.breakMinutes} BETWEEN 0 AND 480`),
    check(
      'work_schedules_days',
      sql`${t.workingDays} <@ '{0,1,2,3,4,5,6}'::smallint[] AND cardinality(${t.workingDays}) BETWEEN 1 AND 7`,
    ),
    uniqueIndex('work_schedules_default_uq').on(t.companyId).where(sql`${t.isDefault}`),
  ],
);

export const holidays = pgTable(
  'holidays',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    date: date().notNull(),
    name: text().notNull(),
    type: holidayType().notNull().default('public'),
    ...standardColumns(),
  },
  (t) => [unique('holidays_date_uq').on(t.companyId, t.date)],
);
