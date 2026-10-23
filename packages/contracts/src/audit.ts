import { z } from 'zod';
import { IsoDateSchema, PageQuerySchema } from './primitives';

export const auditCategoryValues = ['business', 'payroll', 'security', 'technical'] as const;
export type AuditCategory = (typeof auditCategoryValues)[number];

/** Audited actions (AUDIT.md §3). Add new ones here and in AUDIT.md in the same change. */
export const AUDIT_ACTIONS = [
  'user.signed_in',
  'user.sign_in_failed',
  'user.signed_out',
  'user.step_up_completed',
  'user.invited',
  'user.invitation_resent',
  'user.invitation_accepted',
  'user.suspended',
  'user.reactivated',
  'user.deactivated',
  'user.auth_reset',
  'user.passkey_added',
  'user.passkey_removed',
  'user.totp_enabled',
  'user.totp_disabled',
  'user.backup_codes_regenerated',
  'role.granted',
  'role.revoked',
  'role.permissions_changed',
  'role.updated',
  'settings.changed',
  'company.updated',
  'department.created',
  'department.updated',
  'position.created',
  'position.updated',
  'work_schedule.created',
  'work_schedule.updated',
  'schedule_assignment.created',
  'holiday.created',
  'holiday.updated',
  'holiday.deleted',
  'employee.created',
  'employee.updated',
  'employee.status_changed',
  'employee.archived',
  'employee.imported',
  'employee.contact_updated',
  'employee.contact_viewed',
  'employment_event.created',
  'employment_event.applied',
  'employment_event.cancelled',
  'contract.created',
  'contract.updated',
  'profile_change.requested',
  'profile_change.approved',
  'profile_change.rejected',
  'profile_change.withdrawn',
  'attendance.manual_entry_created',
  'attendance_correction.requested',
  'attendance_correction.approved',
  'attendance_correction.rejected',
  'attendance_correction.withdrawn',
  'leave_type.created',
  'leave_type.updated',
  'leave_policy.created',
  'leave_request.created',
  'leave_request.approved',
  'leave_request.rejected',
  'leave_request.withdrawn',
  'leave_request.cancellation_requested',
  'leave_request.cancelled',
  'leave_request.cancellation_rejected',
  'leave_balance.adjusted',
  'reimbursement_claim.submitted',
  'reimbursement_claim.approved',
  'reimbursement_claim.rejected',
  'reimbursement_claim.withdrawn',
  'salary_structure.created',
  'salary_structure.approved',
  'payroll_run.created',
  'payroll_run.calculated',
  'payroll_run.submitted',
  'payroll_run.returned',
  'payroll_run.approved',
  'payroll_run.locked',
  'payroll_run.paid',
  'payroll_run.reconciled',
  'payroll_adjustment.created',
  'payroll_adjustment.approved',
  'payroll_adjustment.rejected',
  'payroll_adjustment.applied',
  'payroll_payment.recorded',
  'payroll_payment.cancelled',
  'payslips.published',
  'payslip.viewed',
  'document.uploaded',
  'document.version_added',
  'document.deleted',
  'document.downloaded',
  'report.exported',
  'job.failed',
  'job.run_requested',
  'outbox.message_dead',
  'outbox.retry_requested',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Metadata keys whose values never reach the audit log (AUDIT.md §4). Matching is by exact key, case-insensitive;
 * the value is replaced with "changed" so the field name stays visible.
 */
export const AUDIT_REDACTED_KEYS = [
  'otp',
  'otpCode',
  'totp',
  'totpCode',
  'totpSecret',
  'secret',
  'backupCode',
  'backupCodes',
  'token',
  'sessionToken',
  'invitationToken',
  'cookie',
  'password',
  'nationalId',
  'nationalIdNumber',
  'personalPhone',
  'personalEmail',
  'address',
  'presentAddress',
  'permanentAddress',
  'emergencyContacts',
  'dateOfBirth',
] as const;

export const AuditLogEntrySchema = z.object({
  id: z.uuid(),
  occurredAt: z.string(),
  actorUserId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  actorType: z.enum(['user', 'system']),
  action: z.string(),
  category: z.enum(auditCategoryValues),
  entityType: z.string(),
  entityId: z.uuid().nullable(),
  employeeId: z.uuid().nullable(),
  requestId: z.string().nullable(),
  ipAddress: z.string().nullable(),
  /** Absent when the caller may see the event but not its details (AUDIT.md §5, `audit.read.technical`). */
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

/** `GET /audit-logs` (AUDIT.md §5). `from` and `to` are Asia/Dhaka business dates, inclusive, at most 366 days apart. */
export const AuditLogQuerySchema = PageQuerySchema.extend({
  from: IsoDateSchema,
  to: IsoDateSchema,
  actorUserId: z.uuid().optional(),
  /** Prefix match, e.g. `payroll_run.` */
  action: z
    .string()
    .regex(/^[a-z_.]{1,80}$/)
    .optional(),
  category: z.enum(auditCategoryValues).optional(),
  entityType: z
    .string()
    .regex(/^[a-z_]{1,60}$/)
    .optional(),
  entityId: z.uuid().optional(),
  employeeId: z.uuid().optional(),
})
  .strict()
  .refine((q) => q.from <= q.to, { path: ['to'], message: 'Must be on or after from' })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= 365, {
    path: ['to'],
    message: 'At most 366 days',
  });
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;
