import type {
  AttendanceCorrection,
  AttendanceCorrectionListQuery,
  CreateAttendanceCorrectionInput,
  DecisionInput,
  RejectInput,
  WithdrawAttendanceCorrectionInput,
} from '@hrm/contracts';
import { schema, uuidv7 } from '@hrm/db';
import { addDays, businessDayBounds, isEmployedOn, localTimeOfDay, toBusinessDate } from '@hrm/domain';
import type { SQL } from 'drizzle-orm';
import { recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import { withDbErrors } from '../../lib/db-errors';
import type { Deps } from '../../lib/deps';
import { isoOrNull, stamp } from '../../lib/dto';
import { enqueue } from '../../lib/outbox';
import { pageMeta, pageOffset } from '../../lib/pagination';
import { AppError, invalidTransition, notFound, validationFailed, versionConflict } from '../../lib/problem';
import { getSetting } from '../../lib/settings';
import {
  type ApprovalSubject,
  decideApproval,
  openApproval,
  resolveManagerApprover,
  stepRecipients,
  withdrawApproval,
} from '../approvals/approvals.service';
import { attendancePolicy as policy } from './attendance.policy';
import * as repo from './attendance.repository';
import { recomputeDay } from './attendance.service';

const { attendanceCorrections } = schema;

function toCorrection(row: repo.CorrectionRow): AttendanceCorrection {
  const c = row.c;
  return {
    id: c.id,
    employee: { id: c.employeeId, employeeCode: row.employeeCode, name: row.employeeName },
    workDate: c.workDate,
    status: c.status as AttendanceCorrection['status'],
    proposedCheckInAt: isoOrNull(c.proposedCheckInAt),
    proposedCheckOutAt: isoOrNull(c.proposedCheckOutAt),
    reason: c.reason,
    decidedAt: isoOrNull(c.decidedAt),
    decisionComment: c.decisionComment,
    ...stamp(c),
  };
}

const subject = (id: string): ApprovalSubject => ({ type: 'attendance_correction', id });
const label = (workDate: string) => `attendance correction for ${workDate}`;
const invalidDate = (detail: string) => new AppError('INVALID_DATE', 'Invalid date', detail);

export async function listCorrections(deps: Deps, auth: AuthContext, q: AttendanceCorrectionListQuery) {
  const { review, ownEmployeeId } = await policy.correctionListScope(auth);
  let visible: SQL | undefined;
  if (review?.employees !== 'all') {
    const ids = new Set(review ? review.employees : []);
    if (ownEmployeeId) ids.add(ownEmployeeId);
    visible = repo.inScope(attendanceCorrections.employeeId, {
      companyId: auth.companyId,
      employees: [...ids],
    });
  }
  const rows = await repo.listCorrections(deps.db, {
    companyId: auth.companyId,
    visible,
    statuses: q.status,
    employeeId: q.employeeId,
    limit: q.pageSize,
    offset: pageOffset(q),
  });
  return { data: rows.map(toCorrection), page: pageMeta(q, rows[0]?.total ?? 0) };
}

/**
 * `POST /attendance/corrections` (FR-ATT-006): a pending correction of the caller's own day, with an approval request
 * to the manager or, without one, to HR (D-014, BUSINESS-RULES 7.3).
 */
export async function requestCorrection(
  deps: Deps,
  auth: AuthContext,
  input: CreateAttendanceCorrectionInput,
) {
  const employeeId = policy.requestCorrection(auth);
  const now = deps.clock.now();
  const today = toBusinessDate(now);
  const windowDays = await getSetting(deps.db, auth.companyId, 'attendance.correction_window_days');
  if (input.workDate > today) throw invalidDate('A correction cannot be for a future date.');
  if (input.workDate < addDays(today, -windowDays))
    throw invalidDate(`Corrections are accepted for the last ${windowDays} days only.`);
  const ctx = await repo.loadDayContext(deps.db, auth.companyId, employeeId, input.workDate);
  if (
    !ctx ||
    !isEmployedOn(
      { status: ctx.employee_status, joiningDate: ctx.joining_date, separationDate: ctx.separation_date },
      input.workDate,
    )
  )
    throw invalidDate('You were not employed on that date.');

  const checkIn = input.proposedCheckInAt ? new Date(input.proposedCheckInAt) : null;
  const checkOut = input.proposedCheckOutAt ? new Date(input.proposedCheckOutAt) : null;
  const errors = [];
  if (checkIn && toBusinessDate(checkIn) !== input.workDate)
    errors.push({
      path: '/proposedCheckInAt',
      code: 'custom',
      message: 'Check-in must fall on the work date.',
    });
  if (
    checkOut &&
    (checkOut <= businessDayBounds(input.workDate).start ||
      toBusinessDate(checkOut) > addDays(input.workDate, 1))
  )
    errors.push({
      path: '/proposedCheckOutAt',
      code: 'custom',
      message: 'Check-out must be on the work date or the night after.',
    });
  if ((checkIn && checkIn > now) || (checkOut && checkOut > now))
    errors.push({ path: '/proposedCheckOutAt', code: 'custom', message: 'Times cannot be in the future.' });
  if (errors.length) throw validationFailed(errors);

  const id = uuidv7(now.getTime());
  const outboxIds = await deps.db.transaction(async (tx) => {
    await withDbErrors(
      () =>
        repo.insertCorrection(tx, {
          id,
          companyId: auth.companyId,
          employeeId,
          workDate: input.workDate,
          status: 'pending',
          proposedCheckInAt: checkIn,
          proposedCheckOutAt: checkOut,
          reason: input.reason,
          createdBy: auth.userId,
          updatedBy: auth.userId,
          createdAt: now,
          updatedAt: now,
        }),
      { attendance_corrections_pending_uq: { code: 'DUPLICATE', path: '/workDate' } },
    );
    const approver = await resolveManagerApprover(tx, {
      companyId: auth.companyId,
      subjectEmployeeId: employeeId,
      requesterUserId: auth.userId,
      fallback: policy.reviewAllPermission,
    });
    const approvalRequestId = await openApproval(tx, {
      companyId: auth.companyId,
      subject: subject(id),
      requesterUserId: auth.userId,
      subjectEmployeeId: employeeId,
      approver,
      actorUserId: auth.userId,
    });
    await recordAudit(tx, auth.actor, {
      action: 'attendance_correction.requested',
      category: 'business',
      entityType: 'attendance_correction',
      entityId: id,
      employeeId,
      metadata: {
        workDate: input.workDate,
        proposedCheckInAt: input.proposedCheckInAt ?? null,
        proposedCheckOutAt: input.proposedCheckOutAt ?? null,
        approvalRequestId,
      },
    });
    const recipients = (await stepRecipients(tx, auth.companyId, approver)).filter((u) => u !== auth.userId);
    const facts = [
      `Date: ${input.workDate}`,
      ...(checkIn ? [`Proposed check-in: ${localTimeOfDay(checkIn)}`] : []),
      ...(checkOut ? [`Proposed check-out: ${localTimeOfDay(checkOut)}`] : []),
    ];
    return enqueue(
      tx,
      auth.actor,
      ...recipients.map((recipientUserId) => ({
        topic: 'email.approval_requested' as const,
        payload: {
          recipientUserId,
          subjectLabel: label(input.workDate),
          requesterName: auth.employee?.name ?? auth.user.name,
          facts,
          path: `/approvals/${approvalRequestId}`,
        },
        dedupeKey: `attendance_correction.requested:${id}:${recipientUserId}`,
      })),
    );
  });
  const row = await repo.findCorrection(deps.db, auth.scopeOwn(), id);
  if (!row) throw notFound();
  return { correction: toCorrection(row), outboxIds };
}

/**
 * Approve or reject (FR-ATT-007): the assigned manager, or HR on behalf (audited, D-014). Approval appends a
 * `correction` event, keeps the originals (FR-ATT-008) and recomputes the day. No payroll effect (D-017).
 */
export async function decideCorrection(
  deps: Deps,
  auth: AuthContext,
  id: string,
  decision: 'approved' | 'rejected',
  input: DecisionInput | RejectInput,
) {
  const scope = await policy.reviewScope(auth);
  if (!scope) throw notFound();
  const now = deps.clock.now();
  const comment = input.comment ?? null;
  const outboxIds = await deps.db.transaction(async (tx) => {
    const row = await repo.findCorrection(tx, scope, id, true);
    if (!row) throw notFound();
    const c = row.c;
    if (c.employeeId === auth.employeeId)
      throw new AppError('SELF_APPROVAL_FORBIDDEN', 'You cannot decide your own request');
    if (c.status !== 'pending')
      throw invalidTransition(c.status, decision === 'approved' ? 'approve' : 'reject');
    if (c.version !== input.version) throw versionConflict();
    const decided = await decideApproval(tx, auth, {
      subject: subject(id),
      decision,
      comment,
      now,
      onBehalfOf: policy.reviewAllPermission,
    });
    const updated = await repo.updateCorrectionStatus(tx, {
      companyId: auth.companyId,
      id,
      version: input.version,
      status: decision,
      userId: auth.userId,
      now,
      comment,
      decided: true,
    });
    if (!updated) throw versionConflict();
    if (decision === 'approved') {
      await repo.lockEmployeePunches(tx, c.employeeId);
      await repo.insertEvent(tx, {
        id: uuidv7(now.getTime()),
        companyId: auth.companyId,
        employeeId: c.employeeId,
        workDate: c.workDate,
        type: 'correction',
        occurredAt: (c.proposedCheckInAt ?? c.proposedCheckOutAt) as Date,
        recordedAt: now,
        source: 'correction',
        checkInAt: c.proposedCheckInAt,
        checkOutAt: c.proposedCheckOutAt,
        correctionId: id,
        reason: c.reason,
        recordedBy: auth.userId,
      });
      await recomputeDay(tx, auth.companyId, c.employeeId, c.workDate, now);
    }
    await recordAudit(tx, auth.actor, {
      action: decision === 'approved' ? 'attendance_correction.approved' : 'attendance_correction.rejected',
      category: 'business',
      entityType: 'attendance_correction',
      entityId: id,
      employeeId: c.employeeId,
      metadata: {
        from: 'pending',
        to: decision,
        workDate: c.workDate,
        onBehalf: decided.onBehalf,
        approvalRequestId: decided.approvalRequestId,
      },
    });
    return enqueue(tx, auth.actor, {
      topic: 'email.request_decided',
      payload: {
        recipientUserId: decided.requesterUserId,
        subjectLabel: label(c.workDate),
        decision,
        comment,
        reviewerUserId: auth.userId,
        path: '/attendance',
      },
      dedupeKey: `attendance_correction.${decision}:${id}`,
    });
  });
  const row = await repo.findCorrection(deps.db, auth.scopeAll(), id);
  if (!row) throw notFound();
  return { correction: toCorrection(row), outboxIds };
}

/** The requester withdraws a pending correction (DOMAIN-MODEL 5.4). */
export async function withdrawCorrection(
  deps: Deps,
  auth: AuthContext,
  id: string,
  input: WithdrawAttendanceCorrectionInput,
) {
  policy.requestCorrection(auth);
  const scope = auth.scopeOwn();
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    const row = await repo.findCorrection(tx, scope, id, true);
    if (!row) throw notFound();
    if (row.c.status !== 'pending') throw invalidTransition(row.c.status, 'withdraw');
    const updated = await repo.updateCorrectionStatus(tx, {
      companyId: auth.companyId,
      id,
      version: input.version,
      status: 'withdrawn',
      userId: auth.userId,
      now,
      comment: null,
      decided: false,
    });
    if (!updated) throw versionConflict();
    await withdrawApproval(tx, auth.companyId, subject(id), auth.userId, now);
    await recordAudit(tx, auth.actor, {
      action: 'attendance_correction.withdrawn',
      category: 'business',
      entityType: 'attendance_correction',
      entityId: id,
      employeeId: row.c.employeeId,
      metadata: { from: 'pending', to: 'withdrawn', workDate: row.c.workDate },
    });
  });
  const row = await repo.findCorrection(deps.db, scope, id);
  if (!row) throw notFound();
  return toCorrection(row);
}
