import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyColumn, standardColumns, tsz, userRef } from './columns';
import { companies } from './companies';
import { contractType, documentCategory, employeeStatus, employmentEventType } from './enums';
import { departments, positions } from './organization';
import { citext } from './types';
import { users } from './users';

// DATA-MODEL.md §4 (employees) and §9 (documents, kept here to avoid a cross-file cycle).

export const employees = pgTable(
  'employees',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    userId: uuid()
      .unique()
      .references(() => users.id, { onDelete: 'restrict' }),
    employeeCode: text().notNull(),
    firstName: text().notNull(),
    lastName: text().notNull(),
    preferredName: text(),
    workEmail: citext(),
    workPhone: text(),
    dateOfBirth: date(),
    gender: text(),
    status: employeeStatus().notNull().default('draft'),
    departmentId: uuid().references(() => departments.id, { onDelete: 'restrict' }),
    positionId: uuid().references(() => positions.id, { onDelete: 'restrict' }),
    managerId: uuid().references((): AnyPgColumn => employees.id, { onDelete: 'restrict' }),
    joiningDate: date(),
    probationEndDate: date(),
    separationDate: date(),
    separationType: text(),
    archivedAt: tsz(),
    ...standardColumns(),
  },
  (t) => [
    unique('employees_code_uq').on(t.companyId, t.employeeCode),
    check('employees_not_self_manager', sql`${t.managerId} IS NULL OR ${t.managerId} <> ${t.id}`),
    check(
      'employees_joining_required',
      sql`${t.status} IN ('draft', 'preboarding') OR ${t.joiningDate} IS NOT NULL`,
    ),
    check(
      'employees_separation_after_joining',
      sql`${t.separationDate} IS NULL OR ${t.joiningDate} IS NULL OR ${t.separationDate} >= ${t.joiningDate}`,
    ),
    check(
      'employees_gender',
      sql`${t.gender} IS NULL OR ${t.gender} IN ('female', 'male', 'other', 'undisclosed')`,
    ),
    check(
      'employees_separation_type',
      sql`${t.separationType} IS NULL OR ${t.separationType} IN ('resignation', 'termination', 'contract_end', 'retirement', 'death', 'other')`,
    ),
    uniqueIndex('employees_work_email_uq')
      .on(t.companyId, t.workEmail)
      .where(sql`${t.workEmail} IS NOT NULL`),
    index('employees_manager_idx').on(t.managerId),
    index('employees_department_idx').on(t.companyId, t.departmentId),
    index('employees_status_idx').on(t.companyId, t.status),
  ],
);

export const codeSequences = pgTable(
  'code_sequences',
  {
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    scope: text().notNull(),
    nextValue: bigint({ mode: 'number' }).notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.scope] }),
    check(
      'code_sequences_scope',
      sql`${t.scope} IN ('employee', 'leave_request', 'reimbursement_claim', 'payroll_run')`,
    ),
    check('code_sequences_positive', sql`${t.nextValue} > 0`),
  ],
);

export const employeeContacts = pgTable(
  'employee_contacts',
  {
    employeeId: uuid()
      .primaryKey()
      .references(() => employees.id, { onDelete: 'restrict' }),
    personalEmail: citext(),
    personalPhone: text(),
    presentAddress: text(),
    permanentAddress: text(),
    nationalIdNumber: text(),
    emergencyContacts: jsonb().notNull().default([]),
    ...standardColumns(),
  },
  (t) => [check('employee_contacts_emergency_array', sql`jsonb_typeof(${t.emergencyContacts}) = 'array'`)],
);

export const employmentEvents = pgTable(
  'employment_events',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    type: employmentEventType().notNull(),
    effectiveDate: date().notNull(),
    status: text().notNull().default('scheduled'),
    changes: jsonb().notNull(),
    reason: text(),
    appliedAt: tsz(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: userRef(),
  },
  (t) => [
    check('employment_events_status', sql`${t.status} IN ('scheduled', 'applied', 'cancelled')`),
    index('employment_events_employee_idx').on(t.employeeId, t.effectiveDate.desc()),
    index('employment_events_due_idx').on(t.effectiveDate).where(sql`${t.status} = 'scheduled'`),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    employeeId: uuid().references(() => employees.id, { onDelete: 'restrict' }),
    category: documentCategory().notNull(),
    title: text().notNull(),
    isRestricted: boolean().notNull().default(false),
    issueDate: date(),
    expiryDate: date(),
    currentVersion: integer().notNull().default(1),
    status: text().notNull().default('active'),
    deletedAt: tsz(),
    deletedReason: text(),
    ...standardColumns(),
  },
  (t) => [
    check(
      'documents_dates',
      sql`${t.expiryDate} IS NULL OR ${t.issueDate} IS NULL OR ${t.expiryDate} >= ${t.issueDate}`,
    ),
    check('documents_status', sql`${t.status} IN ('active', 'deleted')`),
    check(
      'documents_deleted_fields',
      sql`${t.status} <> 'deleted' OR (${t.deletedAt} IS NOT NULL AND ${t.deletedReason} IS NOT NULL)`,
    ),
    index('documents_employee_idx').on(t.employeeId, t.category),
    index('documents_expiry_idx')
      .on(t.expiryDate)
      .where(sql`${t.status} = 'active' AND ${t.expiryDate} IS NOT NULL`),
  ],
);

export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid().primaryKey(),
    documentId: uuid()
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    version: integer().notNull(),
    storageKey: text().notNull().unique(),
    fileName: text().notNull(),
    mimeType: text().notNull(),
    sizeBytes: integer().notNull(),
    sha256: char({ length: 64 }).notNull(),
    uploadedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    uploadedBy: userRef(),
  },
  (t) => [
    unique('document_versions_uq').on(t.documentId, t.version),
    check('document_versions_positive', sql`${t.version} > 0`),
    check(
      'document_versions_mime',
      sql`${t.mimeType} IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')`,
    ),
    check('document_versions_size', sql`${t.sizeBytes} BETWEEN 1 AND 10485760`),
  ],
);

export const employmentContracts = pgTable(
  'employment_contracts',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    type: contractType().notNull(),
    startDate: date().notNull(),
    endDate: date(),
    status: text().notNull().default('active'),
    documentId: uuid().references(() => documents.id, { onDelete: 'restrict' }),
    notes: text(),
    ...standardColumns(),
  },
  (t) => [
    check('employment_contracts_dates', sql`${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`),
    check('employment_contracts_fixed_term', sql`${t.type} <> 'fixed_term' OR ${t.endDate} IS NOT NULL`),
    check(
      'employment_contracts_status',
      sql`${t.status} IN ('draft', 'active', 'expired', 'terminated', 'superseded')`,
    ),
    index('employment_contracts_employee_idx').on(t.employeeId, t.startDate.desc()),
    index('employment_contracts_expiry_idx')
      .on(t.endDate)
      .where(sql`${t.status} = 'active' AND ${t.endDate} IS NOT NULL`),
  ],
);

export const profileChangeRequests = pgTable(
  'profile_change_requests',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    status: text().notNull().default('pending'),
    changes: jsonb().notNull(),
    reason: text(),
    decidedAt: tsz(),
    decidedBy: userRef(),
    decisionComment: text(),
    ...standardColumns(),
  },
  (t) => [
    check(
      'profile_change_requests_status',
      sql`${t.status} IN ('pending', 'approved', 'rejected', 'withdrawn')`,
    ),
    index('profile_change_requests_employee_idx').on(t.employeeId, t.createdAt.desc()),
    uniqueIndex('profile_change_requests_one_pending_uq')
      .on(t.employeeId)
      .where(sql`${t.status} = 'pending'`),
  ],
);
