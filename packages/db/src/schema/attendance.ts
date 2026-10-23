import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyColumn, standardColumns, tsz, userRef } from './columns';
import { employees } from './employees';
import { attendanceEventType, attendanceSource, attendanceStatus } from './enums';
import { workSchedules } from './organization';
import { inet } from './types';

// DATA-MODEL.md §5. The EXCLUDE constraint on schedule_assignments is in the constraints migration.

export const scheduleAssignments = pgTable(
  'schedule_assignments',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    workScheduleId: uuid()
      .notNull()
      .references(() => workSchedules.id, { onDelete: 'restrict' }),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
    ...standardColumns(),
  },
  (t) => [
    check(
      'schedule_assignments_dates',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
    index('schedule_assignments_employee_idx').on(t.employeeId, t.effectiveFrom),
  ],
);

export const attendanceCorrections = pgTable(
  'attendance_corrections',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    workDate: date().notNull(),
    status: text().notNull().default('pending'),
    proposedCheckInAt: tsz(),
    proposedCheckOutAt: tsz(),
    reason: text().notNull(),
    decidedAt: tsz(),
    decidedBy: userRef(),
    decisionComment: text(),
    ...standardColumns(),
  },
  (t) => [
    check(
      'attendance_corrections_status',
      sql`${t.status} IN ('pending', 'approved', 'rejected', 'withdrawn')`,
    ),
    check('attendance_corrections_reason', sql`length(${t.reason}) BETWEEN 5 AND 1000`),
    check(
      'attendance_corrections_has_time',
      sql`${t.proposedCheckInAt} IS NOT NULL OR ${t.proposedCheckOutAt} IS NOT NULL`,
    ),
    index('attendance_corrections_employee_idx').on(t.employeeId, t.workDate.desc()),
    uniqueIndex('attendance_corrections_pending_uq')
      .on(t.employeeId, t.workDate)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const attendanceEvents = pgTable(
  'attendance_events',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    workDate: date().notNull(),
    type: attendanceEventType().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    recordedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    source: attendanceSource().notNull(),
    checkInAt: tsz(),
    checkOutAt: tsz(),
    correctionId: uuid().references(() => attendanceCorrections.id, { onDelete: 'restrict' }),
    reason: text(),
    ipAddress: inet(),
    userAgent: text(),
    recordedBy: userRef(),
  },
  (t) => [
    check(
      'attendance_events_reason',
      sql`${t.type} NOT IN ('manual_entry', 'correction') OR ${t.reason} IS NOT NULL`,
    ),
    check('attendance_events_correction', sql`${t.type} <> 'correction' OR ${t.correctionId} IS NOT NULL`),
    check(
      'attendance_events_order',
      sql`${t.checkOutAt} IS NULL OR ${t.checkInAt} IS NULL OR ${t.checkOutAt} > ${t.checkInAt}`,
    ),
    index('attendance_events_day_idx').on(t.employeeId, t.workDate, t.recordedAt),
  ],
);

export const attendanceRecords = pgTable(
  'attendance_records',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    workDate: date().notNull(),
    workScheduleId: uuid().references(() => workSchedules.id, { onDelete: 'restrict' }),
    firstInAt: tsz(),
    lastOutAt: tsz(),
    workedMinutes: integer().notNull().default(0),
    lateMinutes: integer().notNull().default(0),
    earlyLeaveMinutes: integer().notNull().default(0),
    status: attendanceStatus().notNull(),
    isFinal: boolean().notNull().default(false),
    needsReview: boolean().notNull().default(false),
    hasCorrection: boolean().notNull().default(false),
    computedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    version: integer().notNull().default(1),
  },
  (t) => [
    unique('attendance_records_day_uq').on(t.employeeId, t.workDate),
    check(
      'attendance_records_nonneg',
      sql`${t.workedMinutes} >= 0 AND ${t.lateMinutes} >= 0 AND ${t.earlyLeaveMinutes} >= 0`,
    ),
    index('attendance_records_date_idx').on(t.companyId, t.workDate, t.status),
  ],
);
