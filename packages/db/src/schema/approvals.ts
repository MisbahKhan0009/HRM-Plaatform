import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { permissions } from './access';
import { attendanceCorrections } from './attendance';
import { companyColumn, standardColumns, userRef } from './columns';
import { employees, profileChangeRequests } from './employees';
import { approvalStepDecision, approvalSubjectType } from './enums';
import { leaveRequests } from './leave';
import { payrollAdjustments, payrollRuns } from './payroll';
import { reimbursementClaims } from './reimbursements';
import { users } from './users';

// DATA-MODEL.md §10: one nullable FK per subject type instead of a polymorphic id.
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    subjectType: approvalSubjectType().notNull(),
    leaveRequestId: uuid().references(() => leaveRequests.id, { onDelete: 'restrict' }),
    attendanceCorrectionId: uuid(),
    reimbursementClaimId: uuid(),
    profileChangeRequestId: uuid(),
    payrollRunId: uuid().references(() => payrollRuns.id, { onDelete: 'restrict' }),
    payrollAdjustmentId: uuid(),
    requesterUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    subjectEmployeeId: uuid().references(() => employees.id, { onDelete: 'restrict' }),
    state: text().notNull().default('open'),
    currentStep: smallint().notNull().default(1),
    ...standardColumns(),
  },
  (t) => [
    foreignKey({
      name: 'approval_requests_attendance_correction_fk',
      columns: [t.attendanceCorrectionId],
      foreignColumns: [attendanceCorrections.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'approval_requests_reimbursement_claim_fk',
      columns: [t.reimbursementClaimId],
      foreignColumns: [reimbursementClaims.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'approval_requests_profile_change_fk',
      columns: [t.profileChangeRequestId],
      foreignColumns: [profileChangeRequests.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'approval_requests_payroll_adjustment_fk',
      columns: [t.payrollAdjustmentId],
      foreignColumns: [payrollAdjustments.id],
    }).onDelete('restrict'),
    check('approval_requests_state', sql`${t.state} IN ('open', 'approved', 'rejected', 'withdrawn')`),
    check(
      'approval_requests_one_subject',
      sql`num_nonnulls(${t.leaveRequestId}, ${t.attendanceCorrectionId}, ${t.reimbursementClaimId}, ${t.profileChangeRequestId}, ${t.payrollRunId}, ${t.payrollAdjustmentId}) = 1`,
    ),
    check(
      'approval_requests_subject_match',
      sql`((${t.subjectType} = 'leave_request') = (${t.leaveRequestId} IS NOT NULL))
        AND ((${t.subjectType} = 'attendance_correction') = (${t.attendanceCorrectionId} IS NOT NULL))
        AND ((${t.subjectType} = 'reimbursement_claim') = (${t.reimbursementClaimId} IS NOT NULL))
        AND ((${t.subjectType} = 'profile_change') = (${t.profileChangeRequestId} IS NOT NULL))
        AND ((${t.subjectType} = 'payroll_run') = (${t.payrollRunId} IS NOT NULL))
        AND ((${t.subjectType} = 'payroll_adjustment') = (${t.payrollAdjustmentId} IS NOT NULL))`,
    ),
    index('approval_requests_state_idx').on(t.companyId, t.state, t.subjectType),
  ],
);

export const approvalSteps = pgTable(
  'approval_steps',
  {
    id: uuid().primaryKey(),
    approvalRequestId: uuid()
      .notNull()
      .references(() => approvalRequests.id, { onDelete: 'restrict' }),
    sequence: smallint().notNull(),
    approverUserId: userRef(),
    approverPermission: text().references(() => permissions.code, { onDelete: 'restrict' }),
    decision: approvalStepDecision().notNull().default('pending'),
    decidedBy: userRef(),
    decidedAt: timestamp({ withTimezone: true }),
    comment: text(),
    onBehalf: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('approval_steps_seq_uq').on(t.approvalRequestId, t.sequence),
    check('approval_steps_seq', sql`${t.sequence} > 0`),
    check(
      'approval_steps_approver',
      sql`${t.approverUserId} IS NOT NULL OR ${t.approverPermission} IS NOT NULL`,
    ),
    check(
      'approval_steps_decided',
      sql`${t.decision} = 'pending' OR (${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL)`,
    ),
    index('approval_steps_inbox_user_idx').on(t.approverUserId).where(sql`${t.decision} = 'pending'`),
    index('approval_steps_inbox_perm_idx').on(t.approverPermission).where(sql`${t.decision} = 'pending'`),
  ],
);
