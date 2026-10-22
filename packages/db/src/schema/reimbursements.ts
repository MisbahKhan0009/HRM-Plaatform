import { sql } from 'drizzle-orm';
import { char, check, date, index, numeric, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { companyColumn, standardColumns, tsz, userRef } from './columns';
import { documents, employees } from './employees';
import { payrollItems } from './payroll';

// DATA-MODEL.md §8 (D-020, FR-REIM-001…004).
export const reimbursementClaims = pgTable(
  'reimbursement_claims',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    claimNumber: text().notNull(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    category: text().notNull().default('transport'),
    expenseDate: date().notNull(),
    amount: numeric({ precision: 14, scale: 2 }).notNull(),
    currency: char({ length: 3 }).notNull().default('BDT'),
    description: text().notNull(),
    receiptDocumentId: uuid().references(() => documents.id, { onDelete: 'restrict' }),
    status: text().notNull().default('draft'),
    submittedAt: tsz(),
    decidedAt: tsz(),
    decidedBy: userRef(),
    decisionComment: text(),
    payrollItemId: uuid().references(() => payrollItems.id, { onDelete: 'restrict' }),
    ...standardColumns(),
  },
  (t) => [
    unique('reimbursement_claims_number_uq').on(t.companyId, t.claimNumber),
    check('reimbursement_claims_category', sql`${t.category} IN ('transport')`),
    check('reimbursement_claims_amount', sql`${t.amount} > 0`),
    check('reimbursement_claims_description', sql`length(${t.description}) BETWEEN 3 AND 1000`),
    check(
      'reimbursement_claims_status',
      sql`${t.status} IN ('draft', 'submitted', 'approved', 'rejected', 'withdrawn', 'included', 'paid')`,
    ),
    check(
      'reimbursement_claims_payroll_ref',
      sql`${t.status} NOT IN ('included', 'paid') OR ${t.payrollItemId} IS NOT NULL`,
    ),
    index('reimbursement_claims_employee_idx').on(t.employeeId, t.expenseDate.desc()),
    index('reimbursement_claims_status_idx').on(t.companyId, t.status),
  ],
);
