import {
  type ClaimActionInput,
  type ClaimListQuery,
  type ClaimStatus,
  type CreateClaimInput,
  type DecisionInput,
  P,
  type ReimbursementClaim,
  type RejectInput,
  type UpdateClaimInput,
} from '@hrm/contracts';
import { type RequestScope, type Tx, uuidv7 } from '@hrm/db';
import {
  checkClaimExpenseDate,
  isClaimEditable,
  nextClaimStatus,
  toBusinessDate,
  toMoneyString,
} from '@hrm/domain';
import { recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import { nextCodeNumber, padded } from '../../lib/codes';
import type { Deps } from '../../lib/deps';
import { isoOrNull, stamp } from '../../lib/dto';
import { enqueue } from '../../lib/outbox';
import { pageMeta, pageOffset } from '../../lib/pagination';
import {
  AppError,
  forbidden,
  invalidTransition,
  notFound,
  validationFailed,
  versionConflict,
} from '../../lib/problem';
import { getSetting } from '../../lib/settings';
import {
  type ApprovalSubject,
  decideApproval,
  openApproval,
  resolveManagerApprover,
  stepRecipients,
  withdrawApproval,
} from '../approvals/approvals.service';
import { reimbursementsPolicy as policy } from './reimbursements.policy';
import * as repo from './reimbursements.repository';

const money = (amount: string) => ({ amount, currency: 'BDT' as const });

function toClaim(v: repo.ClaimView): ReimbursementClaim {
  const c = v.claim;
  return {
    id: c.id,
    claimNumber: c.claimNumber,
    employee: { id: c.employeeId, employeeCode: v.employeeCode, name: v.employeeName },
    category: 'transport',
    expenseDate: c.expenseDate,
    amount: money(c.amount),
    description: c.description,
    receiptDocumentId: c.receiptDocumentId,
    status: c.status as ReimbursementClaim['status'],
    submittedAt: isoOrNull(c.submittedAt),
    decidedAt: isoOrNull(c.decidedAt),
    decisionComment: c.decisionComment,
    payrollRunNumber: v.runNumber,
    ...stamp(c),
  };
}

const subject = (id: string): ApprovalSubject => ({ type: 'reimbursement_claim', id });

async function reload(deps: Deps, auth: AuthContext, id: string) {
  const view = await repo.findClaim(deps.db, auth.scopeAll(), id);
  if (!view) throw notFound();
  return toClaim(view);
}

async function assertReceipt(
  deps: Deps,
  auth: AuthContext,
  documentId: string | null | undefined,
  employeeId: string,
) {
  if (documentId && !(await repo.receiptBelongsTo(deps.db, auth.companyId, documentId, employeeId)))
    throw validationFailed([
      { path: '/receiptDocumentId', code: 'not_found', message: 'Receipt not found.' },
    ]);
}

// Reads --------------------------------------------------------------------------------------------------------------

export async function listClaims(deps: Deps, auth: AuthContext, q: ClaimListQuery) {
  const scope = await policy.readScope(auth);
  if (!scope) throw forbidden();
  const { rows, total } = await repo.listClaims(
    deps.db,
    scope,
    {
      ...(q.status ? { status: q.status } : {}),
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
    },
    q.pageSize,
    pageOffset(q),
  );
  const page = { data: rows.map(toClaim), page: pageMeta(q, total) };
  if (!auth.can(P.reimbursement.read.all)) return page;
  const pending = await repo.approvedNotIncluded(deps.db, auth.companyId);
  return {
    ...page,
    summary: {
      approvedNotIncluded: { count: pending.count, amount: money(toMoneyString(pending.amount)) },
    },
  };
}

export async function getClaim(deps: Deps, auth: AuthContext, id: string) {
  const scope = await policy.readScope(auth);
  if (!scope) throw notFound();
  const view = await repo.findClaim(deps.db, scope, id);
  if (!view) throw notFound();
  return toClaim(view);
}

// Own drafts (FR-REIM-001, FR-REIM-004) ------------------------------------------------------------------------------

export async function createClaim(deps: Deps, auth: AuthContext, input: CreateClaimInput) {
  const employeeId = policy.ownEmployee(auth);
  await assertReceipt(deps, auth, input.receiptDocumentId, employeeId);
  const id = uuidv7();
  await deps.db.transaction(async (tx) => {
    const n = await nextCodeNumber(tx, auth.companyId, 'reimbursement_claim');
    await repo.insertClaim(tx, {
      id,
      companyId: auth.companyId,
      claimNumber: padded('RC-', n, 6),
      employeeId,
      category: input.category,
      expenseDate: input.expenseDate,
      amount: input.amount.amount,
      currency: input.amount.currency,
      description: input.description,
      receiptDocumentId: input.receiptDocumentId ?? null,
      createdBy: auth.userId,
      updatedBy: auth.userId,
    });
  });
  return reload(deps, auth, id);
}

async function lockOwnDraft(tx: Tx, auth: AuthContext, id: string) {
  const scope = policy.ownScope(auth);
  if (!scope) throw notFound();
  const claim = await repo.lockClaim(tx, scope, id);
  if (!claim) throw notFound();
  return claim;
}

export async function updateClaim(deps: Deps, auth: AuthContext, id: string, input: UpdateClaimInput) {
  const employeeId = policy.ownEmployee(auth);
  await assertReceipt(deps, auth, input.receiptDocumentId, employeeId);
  await deps.db.transaction(async (tx) => {
    const claim = await lockOwnDraft(tx, auth, id);
    if (!isClaimEditable(claim.status as ClaimStatus)) throw invalidTransition(claim.status, 'edit');
    const updated = await repo.updateClaim(tx, id, input.version, {
      ...(input.expenseDate !== undefined ? { expenseDate: input.expenseDate } : {}),
      ...(input.amount !== undefined ? { amount: input.amount.amount, currency: input.amount.currency } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.receiptDocumentId !== undefined ? { receiptDocumentId: input.receiptDocumentId } : {}),
      updatedAt: deps.clock.now(),
      updatedBy: auth.userId,
    });
    if (!updated) throw versionConflict();
  });
  return reload(deps, auth, id);
}

export async function deleteClaim(deps: Deps, auth: AuthContext, id: string) {
  policy.ownEmployee(auth);
  await deps.db.transaction(async (tx) => {
    const claim = await lockOwnDraft(tx, auth, id);
    if (!isClaimEditable(claim.status as ClaimStatus)) throw invalidTransition(claim.status, 'delete');
    await repo.deleteClaim(tx, id);
  });
}

// Transitions (DOMAIN-MODEL 5.5) --------------------------------------------------------------------------------------

export async function submitClaim(deps: Deps, auth: AuthContext, id: string, input: ClaimActionInput) {
  policy.ownEmployee(auth);
  const now = deps.clock.now();
  const maxAge = await getSetting(deps.db, auth.companyId, 'reimbursements.max_claim_age_days');
  const outboxIds = await deps.db.transaction(async (tx) => {
    const claim = await lockOwnDraft(tx, auth, id);
    if (!nextClaimStatus(claim.status as ClaimStatus, 'submit'))
      throw invalidTransition(claim.status, 'submit');
    const dateCheck = checkClaimExpenseDate(claim.expenseDate, toBusinessDate(now), maxAge);
    if (!dateCheck.ok) {
      throw new AppError(
        'INVALID_DATE',
        'Invalid expense date',
        dateCheck.reason === 'IN_FUTURE'
          ? 'The expense date is in the future.'
          : `Claims older than ${maxAge} days cannot be submitted.`,
        [
          {
            path: '/expenseDate',
            code: dateCheck.reason.toLowerCase(),
            message: 'Expense date not allowed.',
          },
        ],
      );
    }
    const updated = await repo.updateClaim(tx, id, input.version, {
      status: 'submitted',
      submittedAt: now,
      updatedAt: now,
      updatedBy: auth.userId,
    });
    if (!updated) throw versionConflict();
    const approver = await resolveManagerApprover(tx, {
      companyId: auth.companyId,
      subjectEmployeeId: claim.employeeId,
      requesterUserId: auth.userId,
      fallback: P.reimbursement.review.all,
    });
    const approvalId = await openApproval(tx, {
      companyId: auth.companyId,
      subject: subject(id),
      requesterUserId: auth.userId,
      subjectEmployeeId: claim.employeeId,
      approver,
      actorUserId: auth.userId,
    });
    await recordAudit(tx, auth.actor, {
      action: 'reimbursement_claim.submitted',
      category: 'business',
      entityType: 'reimbursement_claim',
      entityId: id,
      employeeId: claim.employeeId,
      metadata: { from: claim.status, to: 'submitted', claimNumber: claim.claimNumber, amount: claim.amount },
    });
    const recipients = await stepRecipients(tx, auth.companyId, approver);
    return enqueue(
      tx,
      auth.actor,
      ...recipients.map((userId) => ({
        topic: 'email.approval_requested' as const,
        payload: {
          recipientUserId: userId,
          subjectLabel: `Transport claim ${claim.claimNumber}`,
          requesterName: auth.employee?.name ?? auth.user.name,
          facts: [`Amount: ${claim.amount} BDT`, `Date: ${claim.expenseDate}`],
          path: `/approvals/${approvalId}`,
        },
        dedupeKey: `reimbursement_claim.submitted:${id}:${userId}`,
      })),
    );
  });
  return { claim: await reload(deps, auth, id), outboxIds };
}

export async function withdrawClaim(deps: Deps, auth: AuthContext, id: string, input: ClaimActionInput) {
  policy.ownEmployee(auth);
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    const claim = await lockOwnDraft(tx, auth, id);
    if (!nextClaimStatus(claim.status as ClaimStatus, 'withdraw'))
      throw invalidTransition(claim.status, 'withdraw');
    const updated = await repo.updateClaim(tx, id, input.version, {
      status: 'withdrawn',
      updatedAt: now,
      updatedBy: auth.userId,
    });
    if (!updated) throw versionConflict();
    await withdrawApproval(tx, auth.companyId, subject(id), auth.userId, now);
    await recordAudit(tx, auth.actor, {
      action: 'reimbursement_claim.withdrawn',
      category: 'business',
      entityType: 'reimbursement_claim',
      entityId: id,
      employeeId: claim.employeeId,
      metadata: { from: claim.status, to: 'withdrawn' },
    });
  });
  return reload(deps, auth, id);
}

async function decide(
  deps: Deps,
  auth: AuthContext,
  id: string,
  decision: 'approved' | 'rejected',
  input: { version: number; comment?: string | undefined },
) {
  const scope: RequestScope | null = await policy.reviewScope(auth);
  if (!scope) throw notFound();
  const now = deps.clock.now();
  const outboxIds = await deps.db.transaction(async (tx) => {
    const claim = await repo.lockClaim(tx, scope, id);
    if (!claim) throw notFound();
    // FR-WF-004: never one's own claim, whatever the permissions (US-REIM-002)
    if (claim.employeeId === auth.employeeId)
      throw new AppError('SELF_APPROVAL_FORBIDDEN', 'You cannot decide your own request');
    const action = decision === 'approved' ? 'approve' : 'reject';
    if (!nextClaimStatus(claim.status as ClaimStatus, action)) throw invalidTransition(claim.status, action);
    const comment = input.comment ?? null;
    const step = await decideApproval(tx, auth, {
      subject: subject(id),
      decision,
      comment,
      now,
      onBehalfOf: P.reimbursement.review.all,
    });
    const updated = await repo.updateClaim(tx, id, input.version, {
      status: decision,
      decidedAt: now,
      decidedBy: auth.userId,
      decisionComment: comment,
      updatedAt: now,
      updatedBy: auth.userId,
    });
    if (!updated) throw versionConflict();
    await recordAudit(tx, auth.actor, {
      action: decision === 'approved' ? 'reimbursement_claim.approved' : 'reimbursement_claim.rejected',
      category: 'business',
      entityType: 'reimbursement_claim',
      entityId: id,
      employeeId: claim.employeeId,
      metadata: { from: claim.status, to: decision, comment, ...(step.onBehalf ? { onBehalf: true } : {}) },
    });
    return enqueue(tx, auth.actor, {
      topic: 'email.request_decided',
      payload: {
        recipientUserId: step.requesterUserId,
        subjectLabel: `Transport claim ${claim.claimNumber}`,
        decision,
        comment,
        reviewerUserId: auth.userId,
        path: `/reimbursements/${id}`,
      },
      dedupeKey: `reimbursement_claim.${decision}:${id}`,
    });
  });
  return { claim: await reload(deps, auth, id), outboxIds };
}

export const approveClaim = (deps: Deps, auth: AuthContext, id: string, input: DecisionInput) =>
  decide(deps, auth, id, 'approved', input);

export const rejectClaim = (deps: Deps, auth: AuthContext, id: string, input: RejectInput) =>
  decide(deps, auth, id, 'rejected', input);
