import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyColumn, standardColumns, tsz, userRef } from './columns';
import { documents, employees } from './employees';
import {
  adjustmentType,
  paymentMethod,
  paymentStatus,
  payrollLineCode,
  payrollLineKind,
  payrollRunStatus,
} from './enums';

// DATA-MODEL.md §7. The approved-structure EXCLUDE and lock-guard triggers are in the constraints migration.
const money = () => numeric({ precision: 14, scale: 2 });

export const salaryStructures = pgTable(
  'salary_structures',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    currency: char({ length: 3 }).notNull().default('BDT'),
    grossAmount: money().notNull(),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
    status: text().notNull().default('draft'),
    reason: text(),
    approvedAt: tsz(),
    approvedBy: userRef(),
    ...standardColumns(),
  },
  (t) => [
    check('salary_structures_gross', sql`${t.grossAmount} >= 0`),
    check('salary_structures_dates', sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`),
    check('salary_structures_status', sql`${t.status} IN ('draft', 'approved', 'superseded')`),
    index('salary_structures_employee_idx').on(t.employeeId, t.effectiveFrom.desc()),
  ],
);

export const payrollPeriods = pgTable(
  'payroll_periods',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    year: smallint().notNull(),
    month: smallint().notNull(),
    startDate: date().notNull(),
    endDate: date().notNull(),
    status: text().notNull().default('open'),
    ...standardColumns(),
  },
  (t) => [
    unique('payroll_periods_uq').on(t.companyId, t.year, t.month),
    check('payroll_periods_year', sql`${t.year} BETWEEN 2000 AND 2100`),
    check('payroll_periods_month', sql`${t.month} BETWEEN 1 AND 12`),
    check('payroll_periods_dates', sql`${t.endDate} >= ${t.startDate}`),
    check('payroll_periods_status', sql`${t.status} IN ('open', 'closed')`),
  ],
);

export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    payrollPeriodId: uuid()
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: 'restrict' }),
    runNumber: text().notNull(),
    runType: text().notNull().default('regular'),
    status: payrollRunStatus().notNull().default('draft'),
    calculationRuleVersion: text(),
    calculatedAt: tsz(),
    submittedAt: tsz(),
    preparedBy: userRef(),
    approvedAt: tsz(),
    approvedBy: userRef(),
    selfApproved: boolean().notNull().default(false),
    selfApprovalNote: text(),
    returnedReason: text(),
    lockedAt: tsz(),
    lockedBy: userRef(),
    payslipsPublishedAt: tsz(),
    totalGross: money(),
    totalDeductions: money(),
    totalNet: money(),
    employeeCount: integer(),
    ...standardColumns(),
  },
  (t) => [
    unique('payroll_runs_number_uq').on(t.companyId, t.runNumber),
    check('payroll_runs_type', sql`${t.runType} IN ('regular', 'off_cycle')`),
    check('payroll_runs_self_approval', sql`NOT ${t.selfApproved} OR ${t.selfApprovalNote} IS NOT NULL`),
    uniqueIndex('payroll_runs_one_regular_uq').on(t.payrollPeriodId).where(sql`${t.runType} = 'regular'`),
    index('payroll_runs_status_idx').on(t.companyId, t.status),
  ],
);

export const payrollItems = pgTable(
  'payroll_items',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    payrollRunId: uuid()
      .notNull()
      .references(() => payrollRuns.id, { onDelete: 'restrict' }),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    salaryStructureId: uuid().references(() => salaryStructures.id, { onDelete: 'restrict' }),
    currency: char({ length: 3 }).notNull().default('BDT'),
    grossAmount: money().notNull(),
    deductionAmount: money().notNull().default('0'),
    netAmount: money().notNull(),
    daysInPeriod: smallint().notNull(),
    daysEmployed: smallint().notNull(),
    snapshot: jsonb().notNull(),
    validationFlags: text().array().notNull().default(sql`'{}'`),
    paymentStatus: text().notNull().default('unpaid'),
    ...standardColumns(),
  },
  (t) => [
    unique('payroll_items_employee_uq').on(t.payrollRunId, t.employeeId),
    check('payroll_items_net', sql`${t.netAmount} = ${t.grossAmount} - ${t.deductionAmount}`),
    check('payroll_items_days', sql`${t.daysEmployed} BETWEEN 0 AND ${t.daysInPeriod}`),
    check(
      'payroll_items_payment_status',
      sql`${t.paymentStatus} IN ('unpaid', 'paid', 'failed', 'cancelled')`,
    ),
    index('payroll_items_employee_idx').on(t.employeeId),
  ],
);

export const payrollLineItems = pgTable(
  'payroll_line_items',
  {
    id: uuid().primaryKey(),
    payrollItemId: uuid()
      .notNull()
      .references(() => payrollItems.id, { onDelete: 'restrict' }),
    kind: payrollLineKind().notNull(),
    code: payrollLineCode().notNull(),
    label: text().notNull(),
    amount: money().notNull(),
    sortOrder: smallint().notNull().default(0),
    sourceType: text(),
    sourceId: uuid(),
    calculation: jsonb().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('payroll_line_items_amount', sql`${t.amount} >= 0`),
    check(
      'payroll_line_items_source',
      sql`${t.sourceType} IS NULL OR ${t.sourceType} IN ('salary_structure', 'reimbursement_claim', 'payroll_adjustment')`,
    ),
    index('payroll_line_items_item_idx').on(t.payrollItemId, t.sortOrder),
  ],
);

export const payrollAdjustments = pgTable(
  'payroll_adjustments',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    type: adjustmentType().notNull(),
    lineCode: payrollLineCode().notNull().default('addition'),
    amount: money().notNull(),
    reason: text().notNull(),
    targetPeriodId: uuid()
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: 'restrict' }),
    correctsPayrollItemId: uuid(),
    status: text().notNull().default('pending'),
    decidedAt: tsz(),
    decidedBy: userRef(),
    selfApproved: boolean().notNull().default(false),
    selfApprovalNote: text(),
    appliedPayrollItemId: uuid().references(() => payrollItems.id, { onDelete: 'restrict' }),
    ...standardColumns(),
  },
  (t) => [
    foreignKey({
      name: 'payroll_adjustments_corrects_item_fk',
      columns: [t.correctsPayrollItemId],
      foreignColumns: [payrollItems.id],
    }).onDelete('restrict'),
    check('payroll_adjustments_line_code', sql`${t.lineCode} IN ('addition', 'deduction', 'arrears')`),
    check('payroll_adjustments_amount', sql`${t.amount} > 0`),
    check('payroll_adjustments_reason', sql`length(${t.reason}) BETWEEN 5 AND 1000`),
    check('payroll_adjustments_status', sql`${t.status} IN ('pending', 'approved', 'rejected', 'applied')`),
    check(
      'payroll_adjustments_applied',
      sql`${t.status} <> 'applied' OR ${t.appliedPayrollItemId} IS NOT NULL`,
    ),
    check('payroll_adjustments_self', sql`NOT ${t.selfApproved} OR ${t.selfApprovalNote} IS NOT NULL`),
    index('payroll_adjustments_period_idx').on(t.targetPeriodId, t.status),
  ],
);

export const payrollPayments = pgTable(
  'payroll_payments',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    payrollItemId: uuid()
      .notNull()
      .references(() => payrollItems.id, { onDelete: 'restrict' }),
    method: paymentMethod().notNull(),
    amount: money().notNull(),
    paidOn: date().notNull(),
    chequeNumber: text(),
    reference: text(),
    acknowledgedByName: text(),
    acknowledgmentDocumentId: uuid().references(() => documents.id, { onDelete: 'restrict' }),
    status: paymentStatus().notNull().default('paid'),
    cancelledReason: text(),
    ...standardColumns(),
  },
  (t) => [
    check('payroll_payments_amount', sql`${t.amount} > 0`),
    check('payroll_payments_cheque', sql`${t.method} <> 'cheque' OR ${t.chequeNumber} IS NOT NULL`),
    check('payroll_payments_cancelled', sql`${t.status} <> 'cancelled' OR ${t.cancelledReason} IS NOT NULL`),
    index('payroll_payments_item_idx').on(t.payrollItemId),
    uniqueIndex('payroll_payments_cheque_uq')
      .on(t.companyId, t.chequeNumber)
      .where(sql`${t.chequeNumber} IS NOT NULL AND ${t.status} <> 'cancelled'`),
  ],
);

export const payslips = pgTable(
  'payslips',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    payrollItemId: uuid()
      .notNull()
      .unique()
      .references(() => payrollItems.id, { onDelete: 'restrict' }),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    payrollPeriodId: uuid()
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: 'restrict' }),
    publishedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    publishedBy: userRef(),
    firstViewedAt: tsz(),
  },
  (t) => [index('payslips_employee_idx').on(t.employeeId, t.publishedAt.desc())],
);
