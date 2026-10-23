import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyColumn, standardColumns, tsz, userRef } from './columns';
import { documents, employees } from './employees';
import { employeeStatus, halfDayPart, leaveLedgerType, leaveUnit } from './enums';
import { jobRuns } from './platform';

// DATA-MODEL.md §6. EXCLUDE on leave_policies and the range gist index are in the constraints migration.
const qty = () => numeric({ precision: 6, scale: 2 });

export const leaveTypes = pgTable(
  'leave_types',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    code: text().notNull(),
    name: text().notNull(),
    isPaid: boolean().notNull().default(true),
    allowsHalfDay: boolean().notNull().default(true),
    requiresReason: boolean().notNull().default(false),
    requiresDocumentAfterDays: qty(),
    colorToken: text(),
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    ...standardColumns(),
  },
  (t) => [
    unique('leave_types_code_uq').on(t.companyId, t.code),
    check('leave_types_code_fmt', sql`${t.code} ~ '^[A-Z]{2,10}$'`),
  ],
);

export const leavePolicies = pgTable(
  'leave_policies',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    leaveTypeId: uuid()
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'restrict' }),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
    allocationMethod: text().notNull(),
    annualEntitlement: qty(),
    accrualPerMonth: qty(),
    daysWorkedPerUnit: qty(),
    prorateFirstYear: boolean().notNull().default(true),
    eligibilityAfterDays: integer().notNull().default(0),
    eligibleStatuses: employeeStatus().array().notNull().default(sql`'{probation,active,notice_period}'`),
    maxCarryForward: qty(),
    maxBalance: qty(),
    carryForwardExpiryMonths: integer(),
    allowNegativeBalance: boolean().notNull().default(false),
    maxConsecutiveDays: qty(),
    minNoticeDays: integer().notNull().default(0),
    ...standardColumns(),
  },
  (t) => [
    check(
      'leave_policies_method',
      sql`${t.allocationMethod} IN ('annual_grant', 'monthly_accrual', 'per_days_worked', 'manual')`,
    ),
    check('leave_policies_dates', sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`),
    check(
      'leave_policies_nonneg',
      sql`coalesce(${t.annualEntitlement}, 0) >= 0 AND coalesce(${t.accrualPerMonth}, 0) >= 0 AND coalesce(${t.maxCarryForward}, 0) >= 0 AND coalesce(${t.maxBalance}, 0) >= 0 AND ${t.eligibilityAfterDays} >= 0`,
    ),
    check('leave_policies_days_worked', sql`${t.daysWorkedPerUnit} IS NULL OR ${t.daysWorkedPerUnit} > 0`),
    check(
      'leave_policies_cf_expiry',
      sql`${t.carryForwardExpiryMonths} IS NULL OR ${t.carryForwardExpiryMonths} BETWEEN 1 AND 24`,
    ),
  ],
);

export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    requestNumber: text().notNull(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    leaveTypeId: uuid()
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'restrict' }),
    leavePolicyId: uuid()
      .notNull()
      .references(() => leavePolicies.id, { onDelete: 'restrict' }),
    startDate: date().notNull(),
    endDate: date().notNull(),
    unit: leaveUnit().notNull().default('day'),
    halfDayPart: halfDayPart(),
    requestedUnits: qty().notNull(),
    reason: text(),
    attachmentDocumentId: uuid().references(() => documents.id, { onDelete: 'restrict' }),
    status: text().notNull().default('pending'),
    submittedAt: tsz(),
    decidedAt: tsz(),
    decidedBy: userRef(),
    decisionComment: text(),
    cancellationReason: text(),
    onBehalfBy: userRef(),
    ...standardColumns(),
  },
  (t) => [
    unique('leave_requests_number_uq').on(t.companyId, t.requestNumber),
    check('leave_requests_dates', sql`${t.endDate} >= ${t.startDate}`),
    check('leave_requests_units', sql`${t.requestedUnits} > 0`),
    check(
      'leave_requests_half_day',
      sql`${t.unit} = 'day' OR (${t.startDate} = ${t.endDate} AND ${t.halfDayPart} IS NOT NULL AND ${t.requestedUnits} = 0.5)`,
    ),
    check('leave_requests_half_part', sql`${t.unit} = 'half_day' OR ${t.halfDayPart} IS NULL`),
    check(
      'leave_requests_status',
      sql`${t.status} IN ('draft', 'pending', 'approved', 'rejected', 'withdrawn', 'cancellation_pending', 'cancelled')`,
    ),
    index('leave_requests_employee_idx').on(t.employeeId, t.startDate.desc()),
    index('leave_requests_status_idx').on(t.companyId, t.status, t.startDate),
  ],
);

export const leaveLedgerEntries = pgTable(
  'leave_ledger_entries',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    leaveTypeId: uuid()
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'restrict' }),
    leaveYear: smallint().notNull(),
    type: leaveLedgerType().notNull(),
    amount: qty().notNull(),
    effectiveDate: date().notNull(),
    leaveRequestId: uuid().references(() => leaveRequests.id, { onDelete: 'restrict' }),
    reversesEntryId: uuid(),
    policyId: uuid().references(() => leavePolicies.id, { onDelete: 'restrict' }),
    jobRunId: uuid().references(() => jobRuns.id, { onDelete: 'restrict' }),
    reason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: userRef(),
  },
  (t) => [
    foreignKey({
      name: 'leave_ledger_reverses_fk',
      columns: [t.reversesEntryId],
      foreignColumns: [t.id],
    }).onDelete('restrict'),
    check('leave_ledger_year', sql`${t.leaveYear} BETWEEN 2000 AND 2100`),
    check('leave_ledger_nonzero', sql`${t.amount} <> 0`),
    check(
      'leave_ledger_request_ref',
      sql`${t.type} NOT IN ('reservation', 'reservation_release', 'usage', 'reversal') OR ${t.leaveRequestId} IS NOT NULL`,
    ),
    check('leave_ledger_adjustment_reason', sql`${t.type} <> 'adjustment' OR ${t.reason} IS NOT NULL`),
    check(
      'leave_ledger_sign',
      sql`(${t.type} IN ('reservation', 'usage', 'expiry') AND ${t.amount} < 0) OR (${t.type} IN ('grant', 'accrual', 'reservation_release', 'reversal', 'carry_forward') AND ${t.amount} > 0) OR ${t.type} = 'adjustment'`,
    ),
    index('leave_ledger_balance_idx').on(t.employeeId, t.leaveTypeId, t.leaveYear),
    index('leave_ledger_request_idx').on(t.leaveRequestId),
    uniqueIndex('leave_ledger_accrual_once_uq')
      .on(t.employeeId, t.leaveTypeId, t.type, t.effectiveDate)
      .where(sql`${t.type} IN ('accrual', 'carry_forward', 'expiry')`),
  ],
);

export const leaveBalances = pgTable(
  'leave_balances',
  {
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    leaveTypeId: uuid()
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'restrict' }),
    leaveYear: smallint().notNull(),
    companyId: companyColumn(),
    entitled: qty().notNull().default('0'),
    used: qty().notNull().default('0'),
    reserved: qty().notNull().default('0'),
    adjusted: qty().notNull().default('0'),
    available: qty().generatedAlwaysAs(sql`entitled - used - reserved + adjusted`),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    version: integer().notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.employeeId, t.leaveTypeId, t.leaveYear] })],
);
