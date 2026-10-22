import {
  type CancelLeaveRequestInput,
  type CreateLeaveRequestInput,
  type DecisionInput,
  type LeaveRequestPreview,
  type LeaveRequestsQuery,
  type LeaveVersionInput,
  P,
  type RejectInput,
} from '@hrm/contracts';
import { type RequestScope, type Tx, uuidv7 } from '@hrm/db';
import {
  addDays,
  applyPostings,
  canConsume,
  countLeaveUnits,
  Decimal,
  isEligibleOn,
  type LeaveAction,
  type LeaveRequestStatus,
  leaveYearOf,
  nextLeaveStatus,
  postingsFor,
  toBusinessDate,
  toLeaveQty,
  zeroBalance,
} from '@hrm/domain';
import { recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import { nextCodeNumber, padded } from '../../lib/codes';
import type { Deps } from '../../lib/deps';
import { enqueue, type OutboxMessage } from '../../lib/outbox';
import { pageMeta } from '../../lib/pagination';
import {
  AppError,
  forbidden,
  invalidTransition,
  notFound,
  ruleViolation,
  validationFailed,
  versionConflict,
} from '../../lib/problem';
import {
  type Approver,
  decideApproval,
  openApproval,
  resolveManagerApprover,
  stepRecipients,
  withdrawApproval,
} from '../approvals/approvals.service';
import { toLeaveRequest } from './leave.dto';
import { leavePolicy as policy } from './leave.policy';
import * as repo from './leave.repository';

type Employee = NonNullable<Awaited<ReturnType<typeof repo.findEmployee>>>;
interface EmailFacts {
  id: string;
  number: string;
  employeeName: string;
  typeName: string;
  startDate: string;
  endDate: string;
  units: string;
}

const ACTIVE_FALLBACK = P.leave.request.review.all;
const path = (id: string) => `/leave/requests/${id}`;
const subject = (id: string) => ({ type: 'leave_request' as const, id });

/** Adds the caller's own employee to a scope, so a reviewer acting on their own request gets 403, not 404. */
function withOwn(auth: AuthContext, scope: RequestScope): RequestScope {
  if (scope.employees === 'all' || !auth.employeeId) return scope;
  return { ...scope, employees: [...scope.employees, auth.employeeId] };
}

/**
 * The employee a request is for: from the session for one's own request (FR-ATT-012 pattern), or `employeeId` when HR
 * acts on behalf with `leave.request.review.all` (D-014).
 */
async function resolveEmployee(deps: Deps, auth: AuthContext, employeeId: string | undefined) {
  if (employeeId && employeeId !== auth.employeeId) {
    if (!policy.canActOnBehalf(auth)) throw forbidden();
    const employee = await repo.findEmployee(deps.db, auth.companyId, employeeId);
    if (!employee)
      throw validationFailed([{ path: '/employeeId', code: 'not_found', message: 'Employee not found.' }]);
    return { employee, onBehalf: true };
  }
  const own = policy.ownEmployee(auth);
  if (!own) throw forbidden();
  const employee = await repo.findEmployee(deps.db, auth.companyId, own);
  if (!employee) throw forbidden();
  return { employee, onBehalf: false };
}

/** INVALID_DATE names the offending body field when there is one, so a form can show it next to the date. */
const invalidDate = (detail: string, field?: 'startDate' | 'endDate') =>
  new AppError(
    'INVALID_DATE',
    'Invalid date',
    detail,
    field ? [{ path: `/${field}`, code: 'invalid_date', message: detail }] : [],
  );
const notEligible = (detail: string) => new AppError('LEAVE_NOT_ELIGIBLE', 'Not eligible', detail);

/** BUSINESS-RULES 3.1 and FR-LEAVE-005: everything a request needs that does not depend on locked state. */
async function evaluate(
  deps: Deps,
  auth: AuthContext,
  input: CreateLeaveRequestInput,
  employee: Employee,
  onBehalf: boolean,
) {
  const type = await repo.findType(deps.db, auth.companyId, input.leaveTypeId);
  if (!type?.isActive)
    throw validationFailed([{ path: '/leaveTypeId', code: 'not_found', message: 'Leave type not found.' }]);
  if (input.unit === 'half_day' && !type.allowsHalfDay)
    throw validationFailed([
      { path: '/unit', code: 'half_day_not_allowed', message: 'This leave type is taken in full days.' },
    ]);
  if (type.requiresReason && !input.reason)
    throw validationFailed([{ path: '/reason', code: 'required', message: 'A reason is required.' }]);
  if (leaveYearOf(input.startDate) !== leaveYearOf(input.endDate))
    throw invalidDate('A request may not span two leave years; submit one request per year.', 'endDate');
  if (!employee.joiningDate || input.startDate < employee.joiningDate)
    throw invalidDate('The leave starts before the joining date.', 'startDate');
  if (employee.separationDate && input.endDate > employee.separationDate)
    throw invalidDate('The leave ends after the separation date.', 'endDate');

  const leavePolicy = await repo.policyOnDate(deps.db, auth.companyId, type.id, input.startDate);
  if (!leavePolicy) throw notEligible('No policy for this leave type covers the start date.');
  const eligible = isEligibleOn(
    {
      status: employee.status,
      joiningDate: employee.joiningDate,
      separationDate: employee.separationDate,
      eligibleStatuses: leavePolicy.eligibleStatuses,
      eligibilityAfterDays: leavePolicy.eligibilityAfterDays,
    },
    input.startDate,
  );
  if (!eligible) throw notEligible('The employee is not eligible for this leave type on the start date.');

  // BUSINESS-RULES 3.1: min_notice_days applies to the employee's own requests; HR on behalf bypasses it (audited).
  const today = toBusinessDate(deps.clock.now());
  if (!onBehalf && input.startDate < addDays(today, leavePolicy.minNoticeDays))
    throw invalidDate(
      leavePolicy.minNoticeDays > 0
        ? `This leave type needs ${leavePolicy.minNoticeDays} days' notice.`
        : 'The leave starts in the past.',
      'startDate',
    );

  const cal = await repo.workCalendar(deps.db, auth.companyId, employee.id, input.startDate, input.endDate);
  const counted = countLeaveUnits({
    startDate: input.startDate,
    endDate: input.endDate,
    unit: input.unit,
    ...cal,
  });
  if (!counted.ok) {
    if (counted.reason === 'NO_WORKING_DAYS')
      throw new AppError(
        'LEAVE_NO_WORKING_DAYS',
        'No working days',
        'The dates are only weekends and holidays.',
      );
    if (counted.reason === 'SPANS_LEAVE_YEARS')
      throw invalidDate('A request may not span two leave years.', 'endDate');
    throw validationFailed([{ path: '/endDate', code: 'invalid_range', message: 'Invalid date range.' }]);
  }
  if (leavePolicy.maxConsecutiveDays !== null && counted.units.gt(leavePolicy.maxConsecutiveDays))
    throw ruleViolation(`At most ${leavePolicy.maxConsecutiveDays} consecutive days of this leave type.`);
  return {
    type,
    leavePolicy,
    units: counted.units,
    dates: counted.dates,
    year: leaveYearOf(input.startDate),
    slot: {
      startDate: input.startDate,
      endDate: input.endDate,
      unit: input.unit,
      halfDayPart: input.halfDayPart ?? null,
    },
  };
}

/** `POST /leave/requests/preview`: working days and balance effect without saving (US-LEAVE-003). */
export async function previewRequest(
  deps: Deps,
  auth: AuthContext,
  input: CreateLeaveRequestInput,
): Promise<LeaveRequestPreview> {
  const { employee, onBehalf } = await resolveEmployee(deps, auth, input.employeeId);
  const e = await evaluate(deps, auth, input, employee, onBehalf);
  const [balance, overlaps] = await Promise.all([
    repo.balanceRow(deps.db, auth.companyId, employee.id, e.type.id, e.year),
    repo.hasOverlap(deps.db, employee.id, e.slot),
  ]);
  const available = new Decimal(balance?.available ?? '0');
  return {
    employeeId: employee.id,
    leaveTypeId: e.type.id,
    year: e.year,
    requestedUnits: toLeaveQty(e.units),
    workingDates: e.dates,
    available: toLeaveQty(available),
    availableAfter: toLeaveQty(available.minus(e.units)),
    sufficientBalance: canConsume(available, e.units, e.leavePolicy.allowNegativeBalance),
    overlapsExisting: overlaps,
  };
}

async function approvalEmails(
  tx: Tx,
  auth: AuthContext,
  approver: Approver,
  exclude: (string | null)[],
  request: EmailFacts,
  kind: 'request' | 'cancellation',
): Promise<OutboxMessage[]> {
  const recipients = (await stepRecipients(tx, auth.companyId, approver)).filter((u) => !exclude.includes(u));
  const what = kind === 'request' ? 'Leave request' : 'Leave cancellation';
  return recipients.map((recipientUserId) => ({
    topic: 'email.approval_requested' as const,
    payload: {
      recipientUserId,
      subjectLabel: `${what} ${request.number}`,
      requesterName: request.employeeName,
      facts: [
        request.typeName,
        request.startDate === request.endDate
          ? request.startDate
          : `${request.startDate} to ${request.endDate}`,
        `${request.units} day(s)`,
      ],
      path: path(request.id),
    },
  }));
}

/**
 * `POST /leave/requests` (DOMAIN-MODEL 5.3, BUSINESS-RULES 4.2): creates the request directly in `pending` and reserves
 * the units on the locked balance row, so two simultaneous submissions serialise (FR-LEAVE-013).
 */
export async function createRequest(deps: Deps, auth: AuthContext, input: CreateLeaveRequestInput) {
  const { employee, onBehalf } = await resolveEmployee(deps, auth, input.employeeId);
  const e = await evaluate(deps, auth, input, employee, onBehalf);
  const now = deps.clock.now();
  const { id, outboxIds } = await deps.db.transaction(async (tx) => {
    await repo.lockEmployeeLeave(tx, employee.id);
    if (await repo.hasOverlap(tx, employee.id, e.slot))
      throw new AppError(
        'OVERLAPPING_LEAVE',
        'Overlapping leave',
        'These dates overlap another pending or approved request.',
      );
    const key = { companyId: auth.companyId, employeeId: employee.id, leaveTypeId: e.type.id, year: e.year };
    const balance = await repo.lockBalance(tx, key);
    const available = balance.available ?? '0';
    if (!canConsume(available, e.units, e.leavePolicy.allowNegativeBalance))
      throw new AppError(
        'INSUFFICIENT_BALANCE',
        'Not enough leave balance',
        `Requested ${toLeaveQty(e.units)} days, ${available} days available.`,
      );

    const requestId = uuidv7();
    const number = padded('LV-', await nextCodeNumber(tx, auth.companyId, 'leave_request'), 6);
    await repo.insertRequest(tx, {
      id: requestId,
      companyId: auth.companyId,
      requestNumber: number,
      employeeId: employee.id,
      leaveTypeId: e.type.id,
      leavePolicyId: e.leavePolicy.id,
      startDate: input.startDate,
      endDate: input.endDate,
      unit: input.unit,
      halfDayPart: input.halfDayPart ?? null,
      requestedUnits: toLeaveQty(e.units),
      reason: input.reason ?? null,
      status: 'pending',
      submittedAt: now,
      onBehalfBy: onBehalf ? auth.userId : null,
      createdBy: auth.userId,
      updatedBy: auth.userId,
    });
    const postings = postingsFor('create', e.units);
    await repo.post(
      tx,
      {
        ...key,
        effectiveDate: toBusinessDate(now),
        leaveRequestId: requestId,
        policyId: e.leavePolicy.id,
        createdBy: auth.userId,
      },
      postings,
      applyPostings(zeroBalance(), postings),
    );
    const approver = await resolveManagerApprover(tx, {
      companyId: auth.companyId,
      subjectEmployeeId: employee.id,
      requesterUserId: auth.userId,
      fallback: ACTIVE_FALLBACK,
    });
    await openApproval(tx, {
      companyId: auth.companyId,
      subject: subject(requestId),
      requesterUserId: auth.userId,
      subjectEmployeeId: employee.id,
      approver,
      actorUserId: auth.userId,
    });
    await recordAudit(tx, auth.actor, {
      action: 'leave_request.created',
      category: 'business',
      entityType: 'leave_request',
      entityId: requestId,
      employeeId: employee.id,
      metadata: {
        requestNumber: number,
        leaveTypeCode: e.type.code,
        startDate: input.startDate,
        endDate: input.endDate,
        units: toLeaveQty(e.units),
        onBehalf,
      },
    });
    const messages = await approvalEmails(
      tx,
      auth,
      approver,
      [auth.userId, employee.userId],
      {
        id: requestId,
        number,
        employeeName: employee.name,
        typeName: e.type.name,
        startDate: input.startDate,
        endDate: input.endDate,
        units: toLeaveQty(e.units),
      },
      'request',
    );
    return { id: requestId, outboxIds: await enqueue(tx, auth.actor, ...messages) };
  });
  return { request: await getRequest(deps, auth, id), outboxIds };
}

export async function getRequest(deps: Deps, auth: AuthContext, id: string) {
  const scope = await policy.viewScope(auth);
  if (!scope) throw notFound();
  const row = await repo.findRequest(deps.db, scope, id);
  if (!row) throw notFound();
  return toLeaveRequest(row);
}

export async function listRequests(deps: Deps, auth: AuthContext, q: LeaveRequestsQuery) {
  const scope = await policy.viewScope(auth);
  if (!scope) throw forbidden();
  const { rows, total } = await repo.listRequests(deps.db, scope, q);
  return { data: rows.map(toLeaveRequest), page: pageMeta(q, total) };
}

interface Transition {
  action: LeaveAction;
  version: number;
  comment?: string | null;
}

/** Posts the action's ledger entries on the locked balance row (BUSINESS-RULES 4.1). */
async function postFor(
  tx: Tx,
  auth: AuthContext,
  row: repo.LeaveRequestRow,
  action: LeaveAction,
  today: string,
  reversesEntryId: string | null = null,
) {
  const postings = postingsFor(action, row.requestedUnits);
  if (!postings.length) return;
  const key = {
    companyId: auth.companyId,
    employeeId: row.employeeId,
    leaveTypeId: row.leaveTypeId,
    year: leaveYearOf(row.startDate),
  };
  await repo.lockBalance(tx, key);
  await repo.post(
    tx,
    {
      ...key,
      effectiveDate: today,
      leaveRequestId: row.id,
      reversesEntryId,
      policyId: row.leavePolicyId,
      createdBy: auth.userId,
    },
    postings,
    applyPostings(zeroBalance(), postings),
  );
}

const DECISIONS = {
  approve: { decision: 'approved', audit: 'leave_request.approved' },
  reject: { decision: 'rejected', audit: 'leave_request.rejected' },
  approve_cancellation: { decision: 'approved', audit: 'leave_request.cancelled' },
  reject_cancellation: { decision: 'rejected', audit: 'leave_request.cancellation_rejected' },
} as const;

/**
 * Reviewer decisions (DOMAIN-MODEL 5.3, D-014): the direct manager, or `leave.request.review.all` when the step is
 * HR's or when HR acts on the manager's behalf (audited). Self-approval is forbidden (FR-WF-004). Ledger postings,
 * status, approval step, audit and outbox commit together (FR-LEAVE-009).
 */
async function decide(
  deps: Deps,
  auth: AuthContext,
  id: string,
  t: Transition & { action: keyof typeof DECISIONS },
) {
  const scope = await policy.reviewScope(auth);
  if (!scope) throw notFound();
  const now = deps.clock.now();
  const today = toBusinessDate(now);
  const meta = DECISIONS[t.action];
  return deps.db.transaction(async (tx) => {
    const view = await repo.findRequestForUpdate(tx, withOwn(auth, scope), id);
    if (!view) throw notFound();
    const row = view.request;
    if (auth.employeeId && row.employeeId === auth.employeeId)
      throw new AppError('SELF_APPROVAL_FORBIDDEN', 'You cannot decide your own request');
    const next = nextLeaveStatus(row.status as LeaveRequestStatus, t.action);
    if (!next) throw invalidTransition(row.status, t.action.replace('_', ' '));
    if (row.version !== t.version) throw versionConflict();

    const decision = await decideApproval(tx, auth, {
      subject: subject(id),
      decision: meta.decision,
      comment: t.comment ?? null,
      now,
      onBehalfOf: P.leave.request.review.all,
    });
    const usage = t.action === 'approve_cancellation' ? await repo.findUsageEntry(tx, id) : null;
    await postFor(tx, auth, row, t.action, today, usage);
    const isCancellation = t.action === 'approve_cancellation' || t.action === 'reject_cancellation';
    const updated = await repo.updateRequest(tx, id, t.version, {
      status: next,
      ...(isCancellation
        ? {}
        : { decidedAt: now, decidedBy: auth.userId, decisionComment: t.comment ?? null }),
      updatedAt: now,
      updatedBy: auth.userId,
    });
    if (!updated) throw versionConflict();
    await recordAudit(tx, auth.actor, {
      action: meta.audit,
      category: 'business',
      entityType: 'leave_request',
      entityId: id,
      employeeId: row.employeeId,
      metadata: {
        from: row.status,
        to: next,
        onBehalf: decision.onBehalf,
        approvalRequestId: decision.approvalRequestId,
        ...(t.comment ? { comment: t.comment } : {}),
      },
    });
    const recipient = view.employeeUserId;
    const messages: OutboxMessage[] = [];
    if (recipient && recipient !== auth.userId) {
      messages.push(
        isCancellation
          ? {
              topic: 'email.leave_cancellation_decided',
              payload: {
                recipientUserId: recipient,
                decision: meta.decision,
                dates: row.startDate === row.endDate ? row.startDate : `${row.startDate} to ${row.endDate}`,
                path: path(id),
              },
              dedupeKey: `leave_request.cancellation_${meta.decision}:${decision.approvalRequestId}`,
            }
          : {
              topic: 'email.request_decided',
              payload: {
                recipientUserId: recipient,
                subjectLabel: `Leave request ${row.requestNumber}`,
                decision: meta.decision,
                comment: t.comment ?? null,
                reviewerUserId: auth.userId,
                path: path(id),
              },
              dedupeKey: `leave_request.${meta.decision}:${decision.approvalRequestId}`,
            },
      );
    }
    return { outboxIds: await enqueue(tx, auth.actor, ...messages) };
  });
}

async function afterDecision(deps: Deps, auth: AuthContext, id: string, r: { outboxIds: string[] }) {
  return { request: await getRequest(deps, auth, id), outboxIds: r.outboxIds };
}

export async function approveRequest(deps: Deps, auth: AuthContext, id: string, input: DecisionInput) {
  const r = await decide(deps, auth, id, {
    action: 'approve',
    version: input.version,
    comment: input.comment ?? null,
  });
  return afterDecision(deps, auth, id, r);
}

export async function rejectRequest(deps: Deps, auth: AuthContext, id: string, input: RejectInput) {
  const r = await decide(deps, auth, id, {
    action: 'reject',
    version: input.version,
    comment: input.comment,
  });
  return afterDecision(deps, auth, id, r);
}

export async function approveCancellation(deps: Deps, auth: AuthContext, id: string, input: DecisionInput) {
  const r = await decide(deps, auth, id, {
    action: 'approve_cancellation',
    version: input.version,
    comment: input.comment ?? null,
  });
  return afterDecision(deps, auth, id, r);
}

export async function rejectCancellation(deps: Deps, auth: AuthContext, id: string, input: RejectInput) {
  const r = await decide(deps, auth, id, {
    action: 'reject_cancellation',
    version: input.version,
    comment: input.comment,
  });
  return afterDecision(deps, auth, id, r);
}

/** `pending` → `withdrawn` by the requester only; releases the reservation and closes the approval (DOMAIN-MODEL 5.3). */
export async function withdrawRequest(deps: Deps, auth: AuthContext, id: string, input: LeaveVersionInput) {
  const own = policy.ownEmployee(auth);
  if (!own) throw notFound();
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    const view = await repo.findRequestForUpdate(tx, auth.scopeOwn(), id);
    if (!view) throw notFound();
    const row = view.request;
    const next = nextLeaveStatus(row.status as LeaveRequestStatus, 'withdraw');
    if (!next) throw invalidTransition(row.status, 'withdraw');
    if (row.version !== input.version) throw versionConflict();
    await postFor(tx, auth, row, 'withdraw', toBusinessDate(now));
    if (
      !(await repo.updateRequest(tx, id, input.version, {
        status: next,
        updatedAt: now,
        updatedBy: auth.userId,
      }))
    )
      throw versionConflict();
    await withdrawApproval(tx, auth.companyId, subject(id), auth.userId, now);
    await recordAudit(tx, auth.actor, {
      action: 'leave_request.withdrawn',
      category: 'business',
      entityType: 'leave_request',
      entityId: id,
      employeeId: row.employeeId,
      metadata: { from: row.status, to: next },
    });
  });
  return getRequest(deps, auth, id);
}

/**
 * `approved` → `cancellation_pending` (DOMAIN-MODEL 5.3, FR-LEAVE-010): by the employee, or HR on behalf. Only leave
 * that has not ended yet can be cancelled. Opens a new approval step for the same reviewers.
 */
export async function requestCancellation(
  deps: Deps,
  auth: AuthContext,
  id: string,
  input: CancelLeaveRequestInput,
) {
  const scopes: RequestScope[] = [];
  if (policy.canActOnBehalf(auth)) scopes.push(auth.scopeAll());
  else if (policy.ownEmployee(auth)) scopes.push(auth.scopeOwn());
  const scope = scopes[0];
  if (!scope) throw notFound();
  const now = deps.clock.now();
  const today = toBusinessDate(now);
  const { outboxIds } = await deps.db.transaction(async (tx) => {
    const view = await repo.findRequestForUpdate(tx, scope, id);
    if (!view) throw notFound();
    const row = view.request;
    const onBehalf = row.employeeId !== auth.employeeId;
    if (!onBehalf && !policy.ownEmployee(auth)) throw notFound();
    const next = nextLeaveStatus(row.status as LeaveRequestStatus, 'request_cancellation');
    if (!next) throw invalidTransition(row.status, 'cancel');
    if (row.version !== input.version) throw versionConflict();
    if (row.endDate < today) throw invalidDate('Only current or future leave can be cancelled.');
    if (
      !(await repo.updateRequest(tx, id, input.version, {
        status: next,
        cancellationReason: input.reason ?? null,
        updatedAt: now,
        updatedBy: auth.userId,
      }))
    )
      throw versionConflict();
    const approver = await resolveManagerApprover(tx, {
      companyId: auth.companyId,
      subjectEmployeeId: row.employeeId,
      requesterUserId: auth.userId,
      fallback: ACTIVE_FALLBACK,
    });
    await openApproval(tx, {
      companyId: auth.companyId,
      subject: subject(id),
      requesterUserId: auth.userId,
      subjectEmployeeId: row.employeeId,
      approver,
      actorUserId: auth.userId,
    });
    await recordAudit(tx, auth.actor, {
      action: 'leave_request.cancellation_requested',
      category: 'business',
      entityType: 'leave_request',
      entityId: id,
      employeeId: row.employeeId,
      metadata: { from: row.status, to: next, onBehalf, ...(input.reason ? { reason: input.reason } : {}) },
    });
    const messages = await approvalEmails(
      tx,
      auth,
      approver,
      [auth.userId, view.employeeUserId],
      {
        id,
        number: row.requestNumber,
        employeeName: view.employeeName,
        typeName: view.leaveTypeName,
        startDate: row.startDate,
        endDate: row.endDate,
        units: row.requestedUnits,
      },
      'cancellation',
    );
    return { outboxIds: await enqueue(tx, auth.actor, ...messages) };
  });
  return { request: await getRequest(deps, auth, id), outboxIds };
}
