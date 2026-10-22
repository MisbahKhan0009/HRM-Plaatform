import {
  type AdjustmentQuery,
  type ApprovePayrollInput,
  type CreateAdjustmentInput,
  P,
  type RejectInput,
} from '@hrm/contracts';
import { uuidv7 } from '@hrm/db';
import { checkSelfApproval, nextAdjustmentStatus } from '@hrm/domain';
import { recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import type { Deps } from '../../lib/deps';
import { enqueue } from '../../lib/outbox';
import { pageMeta, pageOffset } from '../../lib/pagination';
import { AppError, invalidTransition, notFound, validationFailed, versionConflict } from '../../lib/problem';
import { getSetting } from '../../lib/settings';
import { decideApproval, openApproval, stepRecipients } from '../approvals/approvals.service';
import { toAdjustment } from './payroll.dto';
import { payrollPolicy as policy } from './payroll.policy';
import * as repo from './payroll.repository';

// Payroll adjustments (FR-PAY-011, D-019, DOMAIN-MODEL 5.7, US-PAY-010): pending → approved → applied (at lock).

const subject = (id: string) => ({ type: 'payroll_adjustment' as const, id });

async function reload(deps: Deps, auth: AuthContext, id: string) {
  const view = await repo.findAdjustment(deps.db, auth.companyId, id);
  if (!view) throw notFound();
  return toAdjustment(view);
}

export async function listAdjustments(deps: Deps, auth: AuthContext, q: AdjustmentQuery) {
  policy.read(auth);
  const { rows, total } = await repo.listAdjustments(
    deps.db,
    auth.companyId,
    {
      ...(q.status ? { status: q.status } : {}),
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      ...(q.periodId ? { periodId: q.periodId } : {}),
    },
    q.pageSize,
    pageOffset(q),
  );
  return { data: rows.map(toAdjustment), page: pageMeta(q, total) };
}

export async function createAdjustment(deps: Deps, auth: AuthContext, input: CreateAdjustmentInput) {
  policy.prepare(auth);
  const [employee, period] = await Promise.all([
    repo.employeeInCompany(deps.db, auth.companyId, input.employeeId),
    repo.findPeriod(deps.db, auth.companyId, input.targetPeriodId),
  ]);
  const errors = [
    ...(employee ? [] : [{ path: '/employeeId', code: 'not_found', message: 'Employee not found.' }]),
    ...(period ? [] : [{ path: '/targetPeriodId', code: 'not_found', message: 'Payroll period not found.' }]),
  ];
  if (
    input.correctsPayrollItemId &&
    !(await repo.lockedItemOf(deps.db, auth.companyId, input.correctsPayrollItemId, input.employeeId))
  )
    errors.push({
      path: '/correctsPayrollItemId',
      code: 'not_found',
      message: 'Not an item of a locked run for this employee.',
    });
  if (errors.length) throw validationFailed(errors);
  // A closed period's regular run is locked: the correction goes to a later period (FR-PAY-011).
  if (period?.status === 'closed')
    throw new AppError('PAYROLL_RUN_LOCKED', 'Payroll period is closed', 'Target a later payroll period.');

  const id = uuidv7();
  const lineCode = input.lineCode ?? input.type;
  const outboxIds = await deps.db.transaction(async (tx) => {
    await repo.insertAdjustment(tx, {
      id,
      companyId: auth.companyId,
      employeeId: input.employeeId,
      type: input.type,
      lineCode,
      amount: input.amount.amount,
      reason: input.reason,
      targetPeriodId: input.targetPeriodId,
      correctsPayrollItemId: input.correctsPayrollItemId ?? null,
      createdBy: auth.userId,
      updatedBy: auth.userId,
    });
    const approver = { permission: P.payroll.approve };
    const approvalId = await openApproval(tx, {
      companyId: auth.companyId,
      subject: subject(id),
      requesterUserId: auth.userId,
      subjectEmployeeId: input.employeeId,
      approver,
      actorUserId: auth.userId,
    });
    await recordAudit(tx, auth.actor, {
      action: 'payroll_adjustment.created',
      category: 'payroll',
      entityType: 'payroll_adjustment',
      entityId: id,
      employeeId: input.employeeId,
      metadata: {
        type: input.type,
        lineCode,
        amount: input.amount.amount,
        targetPeriodId: input.targetPeriodId,
        correctsPayrollItemId: input.correctsPayrollItemId ?? null,
      },
    });
    const recipients = (await stepRecipients(tx, auth.companyId, approver)).filter((u) => u !== auth.userId);
    return enqueue(
      tx,
      auth.actor,
      ...recipients.map((userId) => ({
        topic: 'email.approval_requested' as const,
        payload: {
          recipientUserId: userId,
          subjectLabel: `Payroll ${input.type}`,
          requesterName: auth.user.name,
          facts: [`Period: ${period?.year}-${String(period?.month).padStart(2, '0')}`],
          path: `/approvals/${approvalId}`,
        },
        dedupeKey: `payroll_adjustment.created:${id}:${userId}`,
      })),
    );
  });
  return { adjustment: await reload(deps, auth, id), outboxIds };
}

async function decide(
  deps: Deps,
  auth: AuthContext,
  id: string,
  decision: 'approved' | 'rejected',
  input: { version: number; comment?: string | undefined; selfApprovalNote?: string | undefined },
) {
  const now = deps.clock.now();
  const allowSelf = await getSetting(deps.db, auth.companyId, 'payroll.allow_self_approval');
  const outboxIds = await deps.db.transaction(async (tx) => {
    const adj = await repo.lockAdjustment(tx, auth.companyId, id);
    if (!adj) throw notFound();
    const action = decision === 'approved' ? 'approve' : 'reject';
    if (!nextAdjustmentStatus(adj.status as never, action)) throw invalidTransition(adj.status, action);
    if (adj.version !== input.version) throw versionConflict();
    const requester = await repo.openApprovalRequester(tx, auth.companyId, { payrollAdjustmentId: id });
    const isSelf = adj.createdBy === auth.userId || requester === auth.userId;
    // D-007 applies to approving; rejecting one's own adjustment needs no justification.
    const self =
      decision === 'approved'
        ? checkSelfApproval({ isSelf, allowSelfApproval: allowSelf, note: input.selfApprovalNote })
        : ({ ok: true, selfApproved: false, note: null } as const);
    if (!self.ok)
      throw new AppError(
        self.reason,
        self.reason === 'SELF_APPROVAL_FORBIDDEN'
          ? 'You cannot approve your own adjustment'
          : 'Justification required',
        undefined,
        self.reason === 'SELF_APPROVAL_NOTE_REQUIRED'
          ? [{ path: '/selfApprovalNote', code: 'required', message: 'At least 20 characters.' }]
          : [],
      );
    const comment = input.comment ?? null;
    const step = await decideApproval(tx, auth, {
      subject: subject(id),
      decision,
      comment,
      now,
      onBehalfOf: null,
      allowSelf: true,
    });
    const updated = await repo.updateAdjustment(tx, id, input.version, {
      status: decision,
      decidedAt: now,
      decidedBy: auth.userId,
      selfApproved: self.selfApproved,
      selfApprovalNote: self.note,
      updatedAt: now,
      updatedBy: auth.userId,
    });
    if (!updated) throw versionConflict();
    await recordAudit(tx, auth.actor, {
      action: decision === 'approved' ? 'payroll_adjustment.approved' : 'payroll_adjustment.rejected',
      category: 'payroll',
      entityType: 'payroll_adjustment',
      entityId: id,
      employeeId: adj.employeeId,
      metadata: {
        from: adj.status,
        to: decision,
        comment,
        selfApproved: self.selfApproved,
        ...(self.selfApproved ? { note: self.note } : {}),
      },
    });
    if (step.requesterUserId === auth.userId) return [];
    return enqueue(tx, auth.actor, {
      topic: 'email.request_decided',
      payload: {
        recipientUserId: step.requesterUserId,
        subjectLabel: `Payroll ${adj.type}`,
        decision,
        comment,
        reviewerUserId: auth.userId,
        path: '/payroll/adjustments',
      },
      dedupeKey: `payroll_adjustment.${decision}:${id}`,
    });
  });
  return { adjustment: await reload(deps, auth, id), outboxIds };
}

export function approveAdjustment(deps: Deps, auth: AuthContext, id: string, input: ApprovePayrollInput) {
  policy.approveFresh(auth, deps.clock.now());
  return decide(deps, auth, id, 'approved', input);
}

export function rejectAdjustment(deps: Deps, auth: AuthContext, id: string, input: RejectInput) {
  policy.approve(auth);
  return decide(deps, auth, id, 'rejected', input);
}
