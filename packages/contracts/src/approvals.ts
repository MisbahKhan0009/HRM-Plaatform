import { z } from 'zod';
import { PageQuerySchema } from './primitives';

export const approvalSubjectTypeValues = [
  'leave_request',
  'attendance_correction',
  'reimbursement_claim',
  'profile_change',
  'payroll_run',
  'payroll_adjustment',
] as const;
export const ApprovalSubjectTypeSchema = z.enum(approvalSubjectTypeValues);
export type ApprovalSubjectType = z.infer<typeof ApprovalSubjectTypeSchema>;

export const ApprovalStateSchema = z.enum(['open', 'approved', 'rejected', 'withdrawn']);
export const ApprovalStepDecisionSchema = z.enum(['pending', 'approved', 'rejected', 'skipped']);

const PersonRefSchema = z.object({ id: z.uuid(), name: z.string() });

/** One row of the approval inbox or "my requests" (API-CATALOGUE §10). */
export const ApprovalSummarySchema = z.object({
  id: z.uuid(),
  subjectType: ApprovalSubjectTypeSchema,
  subjectId: z.uuid(),
  state: ApprovalStateSchema,
  requester: PersonRefSchema,
  subjectEmployee: PersonRefSchema.extend({ employeeCode: z.string() }).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ApprovalSummary = z.infer<typeof ApprovalSummarySchema>;

export const ApprovalStepSchema = z.object({
  sequence: z.number().int(),
  decision: ApprovalStepDecisionSchema,
  /** Hidden from the requester when `approvals.hide_reviewer` is on (FR-ESS-007). */
  approverName: z.string().nullable(),
  approverPermission: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  comment: z.string().nullable(),
  onBehalf: z.boolean(),
});

export const ApprovalDetailSchema = ApprovalSummarySchema.extend({ steps: z.array(ApprovalStepSchema) });
export type ApprovalDetail = z.infer<typeof ApprovalDetailSchema>;

export const ApprovalListQuerySchema = PageQuerySchema.extend({
  subjectType: ApprovalSubjectTypeSchema.optional(),
}).strict();
