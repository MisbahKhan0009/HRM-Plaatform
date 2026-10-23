import type { ApprovalSubjectType, Permission } from '@hrm/contracts';
import { schema, type Tx, uuidv7 } from '@hrm/db';
import { and, eq, sql } from 'drizzle-orm';
import type { AuthContext } from '../../lib/auth-context';
import { AppError, notFound } from '../../lib/problem';

const { approvalRequests, approvalSteps } = schema;

export interface ApprovalSubject {
  type: ApprovalSubjectType;
  id: string;
}

/** A step goes to one person (the manager) or to anyone holding a permission (HR, payroll). */
export type Approver = { userId: string } | { permission: Permission };

const SUBJECT_COLUMN = {
  leave_request: approvalRequests.leaveRequestId,
  attendance_correction: approvalRequests.attendanceCorrectionId,
  reimbursement_claim: approvalRequests.reimbursementClaimId,
  profile_change: approvalRequests.profileChangeRequestId,
  payroll_run: approvalRequests.payrollRunId,
  payroll_adjustment: approvalRequests.payrollAdjustmentId,
} as const;

const SUBJECT_KEY = {
  leave_request: 'leaveRequestId',
  attendance_correction: 'attendanceCorrectionId',
  reimbursement_claim: 'reimbursementClaimId',
  profile_change: 'profileChangeRequestId',
  payroll_run: 'payrollRunId',
  payroll_adjustment: 'payrollAdjustmentId',
} as const;

/**
 * Approver for leave, corrections and claims (BUSINESS-RULES §7.3, D-014): the subject employee's manager's active
 * user; if there is none, or the manager is the requester, anyone holding the `.review.all` permission.
 */
export async function resolveManagerApprover(
  tx: Tx,
  input: { companyId: string; subjectEmployeeId: string; requesterUserId: string; fallback: Permission },
): Promise<Approver> {
  const rows = await tx.execute<{ user_id: string | null }>(sql`
    SELECT mu.id AS user_id
    FROM employees e
    JOIN employees m ON m.id = e.manager_id
    LEFT JOIN users mu ON mu.id = m.user_id AND mu.status = 'active'
    WHERE e.id = ${input.subjectEmployeeId} AND e.company_id = ${input.companyId}`);
  const managerUser = rows[0]?.user_id ?? null;
  if (!managerUser || managerUser === input.requesterUserId) return { permission: input.fallback };
  return { userId: managerUser };
}

/** Opens an approval request with its first step, in the subject's transaction. */
export async function openApproval(
  tx: Tx,
  input: {
    companyId: string;
    subject: ApprovalSubject;
    requesterUserId: string;
    subjectEmployeeId: string | null;
    approver: Approver;
    actorUserId: string | null;
  },
) {
  const id = uuidv7();
  await tx.insert(approvalRequests).values({
    id,
    companyId: input.companyId,
    subjectType: input.subject.type,
    [SUBJECT_KEY[input.subject.type]]: input.subject.id,
    requesterUserId: input.requesterUserId,
    subjectEmployeeId: input.subjectEmployeeId,
    createdBy: input.actorUserId,
    updatedBy: input.actorUserId,
  });
  await tx.insert(approvalSteps).values({
    id: uuidv7(),
    approvalRequestId: id,
    sequence: 1,
    approverUserId: 'userId' in input.approver ? input.approver.userId : null,
    approverPermission: 'permission' in input.approver ? input.approver.permission : null,
  });
  return id;
}

async function openRequestFor(tx: Tx, companyId: string, subject: ApprovalSubject) {
  const [req] = await tx
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.companyId, companyId),
        eq(SUBJECT_COLUMN[subject.type], subject.id),
        eq(approvalRequests.state, 'open'),
      ),
    )
    .for('update');
  if (!req) return null;
  const [step] = await tx
    .select()
    .from(approvalSteps)
    .where(and(eq(approvalSteps.approvalRequestId, req.id), eq(approvalSteps.decision, 'pending')))
    .orderBy(approvalSteps.sequence)
    .limit(1);
  return step ? { req, step } : null;
}

/**
 * Who may decide the pending step: its named approver, anyone holding its permission, or a holder of `onBehalfOf`
 * acting on behalf (HR for a manager, D-014; audited). Returns whether the decision is on behalf.
 */
export function decisionRight(
  auth: AuthContext,
  step: { approverUserId: string | null; approverPermission: string | null },
  onBehalfOf: Permission | null,
): { allowed: boolean; onBehalf: boolean } {
  if (step.approverUserId === auth.userId) return { allowed: true, onBehalf: false };
  if (step.approverPermission && auth.can(step.approverPermission as Permission))
    return { allowed: true, onBehalf: false };
  if (onBehalfOf && auth.can(onBehalfOf)) return { allowed: true, onBehalf: true };
  return { allowed: false, onBehalf: false };
}

/**
 * Records a decision on the open request of a subject (FR-WF-003…005). The subject's service has already checked
 * scope and its own transition; this checks the approver and self-approval, and closes the request.
 */
export async function decideApproval(
  tx: Tx,
  auth: AuthContext,
  input: {
    subject: ApprovalSubject;
    decision: 'approved' | 'rejected';
    comment: string | null;
    now: Date;
    /** Permission that may act on behalf of the assigned approver (for example `leave.request.review.all`). */
    onBehalfOf: Permission | null;
    /** Payroll only (D-007): the requester may approve, flagged by the caller. */
    allowSelf?: boolean;
  },
): Promise<{ approvalRequestId: string; onBehalf: boolean; requesterUserId: string }> {
  const open = await openRequestFor(tx, auth.companyId, input.subject);
  if (!open) throw notFound();
  if (open.req.requesterUserId === auth.userId && !input.allowSelf) {
    throw new AppError('SELF_APPROVAL_FORBIDDEN', 'You cannot decide your own request');
  }
  const right = decisionRight(auth, open.step, input.onBehalfOf);
  if (!right.allowed) throw notFound();
  await tx
    .update(approvalSteps)
    .set({
      decision: input.decision,
      decidedBy: auth.userId,
      decidedAt: input.now,
      comment: input.comment,
      onBehalf: right.onBehalf,
    })
    .where(eq(approvalSteps.id, open.step.id));
  await tx
    .update(approvalRequests)
    .set({
      state: input.decision,
      updatedAt: input.now,
      updatedBy: auth.userId,
      version: sql`${approvalRequests.version} + 1`,
    })
    .where(eq(approvalRequests.id, open.req.id));
  return {
    approvalRequestId: open.req.id,
    onBehalf: right.onBehalf,
    requesterUserId: open.req.requesterUserId,
  };
}

/** Closes the open request when the requester withdraws the subject; the pending step becomes `skipped`. */
export async function withdrawApproval(
  tx: Tx,
  companyId: string,
  subject: ApprovalSubject,
  byUserId: string,
  now: Date,
) {
  const open = await openRequestFor(tx, companyId, subject);
  if (!open) return;
  await tx
    .update(approvalSteps)
    .set({ decision: 'skipped', decidedBy: byUserId, decidedAt: now })
    .where(eq(approvalSteps.id, open.step.id));
  await tx
    .update(approvalRequests)
    .set({
      state: 'withdrawn',
      updatedAt: now,
      updatedBy: byUserId,
      version: sql`${approvalRequests.version} + 1`,
    })
    .where(eq(approvalRequests.id, open.req.id));
}

/**
 * After an employee's manager changes, re-assigns their pending manager steps (DATA-MODEL §10): the old step is
 * skipped and a new step goes to the new approver. Decided steps never change (FR-WF-005).
 */
export async function reassignPendingSteps(tx: Tx, companyId: string, subjectEmployeeId: string, now: Date) {
  const pending = await tx
    .select({ req: approvalRequests, step: approvalSteps })
    .from(approvalSteps)
    .innerJoin(approvalRequests, eq(approvalRequests.id, approvalSteps.approvalRequestId))
    .where(
      and(
        eq(approvalRequests.companyId, companyId),
        eq(approvalRequests.subjectEmployeeId, subjectEmployeeId),
        eq(approvalRequests.state, 'open'),
        eq(approvalSteps.decision, 'pending'),
        sql`${approvalSteps.approverUserId} IS NOT NULL`,
      ),
    );
  const fallback: Partial<Record<ApprovalSubjectType, Permission>> = {
    leave_request: 'leave.request.review.all',
    attendance_correction: 'attendance.correction.review.all',
    reimbursement_claim: 'reimbursement.review.all',
  };
  for (const { req, step } of pending) {
    const perm = fallback[req.subjectType];
    if (!perm) continue;
    const approver = await resolveManagerApprover(tx, {
      companyId,
      subjectEmployeeId,
      requesterUserId: req.requesterUserId,
      fallback: perm,
    });
    if ('userId' in approver && approver.userId === step.approverUserId) continue;
    await tx
      .update(approvalSteps)
      .set({ decision: 'skipped', decidedBy: req.requesterUserId, decidedAt: now })
      .where(eq(approvalSteps.id, step.id));
    await tx.insert(approvalSteps).values({
      id: uuidv7(),
      approvalRequestId: req.id,
      sequence: step.sequence + 1,
      approverUserId: 'userId' in approver ? approver.userId : null,
      approverPermission: 'permission' in approver ? approver.permission : null,
    });
    await tx
      .update(approvalRequests)
      .set({ currentStep: step.sequence + 1, updatedAt: now })
      .where(eq(approvalRequests.id, req.id));
  }
}

/** Users who should be emailed about a new step: the named approver, or every active holder of the permission. */
export async function stepRecipients(tx: Tx, companyId: string, approver: Approver): Promise<string[]> {
  if ('userId' in approver) return [approver.userId];
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT DISTINCT u.id FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.permission_code = ${approver.permission}
    WHERE u.company_id = ${companyId} AND u.status = 'active'
    LIMIT 20`);
  return rows.map((r) => r.id);
}
