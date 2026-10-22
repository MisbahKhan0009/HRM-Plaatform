import {
  type CreateProfileChangeRequestInput,
  type DecisionInput,
  P,
  type ProfileChangeField,
  type ProfileChangeListQuery,
  type RejectInput,
  type VersionOnlyInput,
} from '@hrm/contracts';
import { type schema, type Tx, uuidv7 } from '@hrm/db';
import { recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import { withDbErrors } from '../../lib/db-errors';
import type { Deps } from '../../lib/deps';
import { enqueue } from '../../lib/outbox';
import { pageMeta } from '../../lib/pagination';
import { forbidden, invalidTransition, notFound, validationFailed, versionConflict } from '../../lib/problem';
import {
  type Approver,
  decideApproval,
  openApproval,
  stepRecipients,
  withdrawApproval,
} from '../approvals/approvals.service';
import { toProfileChange } from './employees.dto';
import { employeesPolicy as policy } from './employees.policy';
import * as repo from './employees.repository';

/** Fields stored on `employees`; the rest of the allow-list lives on `employee_contacts`. */
const EMPLOYEE_FIELDS = new Set<ProfileChangeField>([
  'firstName',
  'lastName',
  'preferredName',
  'dateOfBirth',
  'gender',
]);

/** Profile changes go to HR (SECURITY-MODEL §6, D-014): anyone holding `profile_change.review.all`. */
const APPROVER: Approver = { permission: P.profileChange.review.all };

const subject = (id: string) => ({ type: 'profile_change' as const, id });

async function load(deps: Deps, auth: AuthContext, id: string) {
  const row = await repo.findProfileChange(deps.db, auth.companyId, id);
  if (!row) throw notFound();
  return toProfileChange(row);
}

/**
 * An employee requests changes to their own profile (FR-EMP-011, US-EMP-008). The employee comes from the session;
 * only allow-listed fields are accepted, so code, department and salary cannot be requested. Stores `{from, to}` per
 * changed field, opens an approval for HR and emails them. Audit metadata lists field names only (AUDIT.md §4).
 */
export async function createProfileChange(
  deps: Deps,
  auth: AuthContext,
  input: CreateProfileChangeRequestInput,
) {
  policy.requestProfileChange(auth);
  const employeeId = auth.employeeId;
  if (!employeeId || !auth.employee) throw forbidden();
  const requesterName = auth.employee.name;

  const { id, outboxIds } = await deps.db.transaction(async (tx) => {
    const emp = await repo.lockEmployee(tx, auth.companyId, employeeId);
    if (!emp) throw notFound();
    const contact = await repo.findContact(tx, employeeId);
    const current = (f: ProfileChangeField): unknown =>
      EMPLOYEE_FIELDS.has(f)
        ? emp[f as keyof typeof emp]
        : f === 'emergencyContacts'
          ? (contact?.emergencyContacts ?? [])
          : (contact?.[f as keyof typeof contact] ?? null);

    const requested: Record<string, { from: unknown; to: unknown }> = {};
    for (const [field, to] of Object.entries(input.changes) as [ProfileChangeField, unknown][]) {
      const from = current(field);
      if (JSON.stringify(from) !== JSON.stringify(to)) requested[field] = { from, to };
    }
    const fields = Object.keys(requested);
    if (!fields.length)
      throw validationFailed([
        { path: '/changes', code: 'no_changes', message: 'Every requested value equals the current one.' },
      ]);

    const newId = uuidv7();
    await withDbErrors(
      () =>
        repo.insertProfileChange(tx, {
          id: newId,
          companyId: auth.companyId,
          employeeId,
          changes: requested,
          reason: input.reason ?? null,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        }),
      { profile_change_requests_one_pending_uq: { code: 'DUPLICATE', path: '/changes' } },
    );
    const approvalId = await openApproval(tx, {
      companyId: auth.companyId,
      subject: subject(newId),
      requesterUserId: auth.userId,
      subjectEmployeeId: employeeId,
      approver: APPROVER,
      actorUserId: auth.userId,
    });
    await recordAudit(tx, auth.actor, {
      action: 'profile_change.requested',
      category: 'business',
      entityType: 'profile_change_request',
      entityId: newId,
      employeeId,
      metadata: { fields },
    });
    const recipients = (await stepRecipients(tx, auth.companyId, APPROVER)).filter((u) => u !== auth.userId);
    const ids = await enqueue(
      tx,
      auth.actor,
      ...recipients.map((recipientUserId) => ({
        topic: 'email.approval_requested' as const,
        // Field names only: the email never carries the new values.
        payload: {
          recipientUserId,
          subjectLabel: 'Profile change',
          requesterName,
          facts: [`Fields: ${fields.join(', ')}`],
          path: `/approvals/${approvalId}`,
        },
        dedupeKey: `profile_change.requested:${newId}:${recipientUserId}`,
      })),
    );
    return { id: newId, outboxIds: ids };
  });
  return { request: await load(deps, auth, id), outboxIds };
}

/** HR sees every request (filters `status`, `employeeId`); everyone else sees their own only. */
export async function listProfileChanges(deps: Deps, auth: AuthContext, query: ProfileChangeListQuery) {
  policy.listProfileChanges(auth);
  const scope = policy.reviewProfileChanges(auth) ? auth.scopeAll() : auth.scopeOwn();
  const { rows, total } = await repo.listProfileChanges(deps.db, scope, query, query);
  return { data: rows.map(toProfileChange), page: pageMeta(query, total) };
}

/** Writes approved values to the employee and contact rows, in the decision's transaction. */
async function applyChanges(
  tx: Tx,
  auth: AuthContext,
  employeeId: string,
  requested: Record<string, { to: unknown }>,
  now: Date,
) {
  const employeeValues: Record<string, unknown> = {};
  const contactValues: Record<string, unknown> = {};
  for (const [field, change] of Object.entries(requested)) {
    if (EMPLOYEE_FIELDS.has(field as ProfileChangeField)) employeeValues[field] = change.to;
    else contactValues[field] = change.to;
  }
  if (Object.keys(employeeValues).length) {
    await repo.updateEmployee(tx, auth.companyId, employeeId, null, {
      ...(employeeValues as Partial<typeof schema.employees.$inferInsert>),
      updatedBy: auth.userId,
      updatedAt: now,
    });
  }
  if (Object.keys(contactValues).length) {
    const values = contactValues as Partial<typeof schema.employeeContacts.$inferInsert>;
    const updated = await repo.updateContact(tx, employeeId, null, {
      ...values,
      updatedBy: auth.userId,
      updatedAt: now,
    });
    if (!updated)
      await repo.insertContact(tx, { employeeId, ...values, createdBy: auth.userId, updatedBy: auth.userId });
  }
}

/**
 * HR approves or rejects (DOMAIN-MODEL §5.8). Approval applies the changes in the same transaction. The requester
 * can never decide their own request (SELF_APPROVAL_FORBIDDEN). Callers without the review permission get 404.
 */
export async function decideProfileChange(
  deps: Deps,
  auth: AuthContext,
  id: string,
  decision: 'approved' | 'rejected',
  input: DecisionInput | RejectInput,
) {
  if (!policy.reviewProfileChanges(auth)) throw notFound();
  const now = deps.clock.now();
  const outboxIds = await deps.db.transaction(async (tx) => {
    const req = await repo.lockProfileChange(tx, auth.companyId, id);
    if (!req) throw notFound();
    if (req.status !== 'pending')
      throw invalidTransition(req.status, decision === 'approved' ? 'approve' : 'reject');
    if (req.version !== input.version) throw versionConflict();
    const comment = input.comment ?? null;
    const result = await decideApproval(tx, auth, {
      subject: subject(id),
      decision,
      comment,
      now,
      onBehalfOf: null,
    });
    const requested = req.changes as Record<string, { from: unknown; to: unknown }>;
    if (decision === 'approved') await applyChanges(tx, auth, req.employeeId, requested, now);
    const updated = await repo.updateProfileChange(tx, id, input.version, {
      status: decision,
      decidedAt: now,
      decidedBy: auth.userId,
      decisionComment: comment,
      updatedBy: auth.userId,
      updatedAt: now,
    });
    if (!updated) throw versionConflict();
    await recordAudit(tx, auth.actor, {
      action: decision === 'approved' ? 'profile_change.approved' : 'profile_change.rejected',
      category: 'business',
      entityType: 'profile_change_request',
      entityId: id,
      employeeId: req.employeeId,
      metadata: { from: 'pending', to: decision, comment, fields: Object.keys(requested) },
    });
    return enqueue(tx, auth.actor, {
      topic: 'email.request_decided',
      payload: {
        recipientUserId: result.requesterUserId,
        subjectLabel: 'Profile change',
        decision,
        comment,
        reviewerUserId: auth.userId,
        path: '/me/profile-changes',
      },
      dedupeKey: `profile_change.decided:${id}`,
    });
  });
  return { request: await load(deps, auth, id), outboxIds };
}

/** The requester withdraws their pending request; anyone else gets 404. */
export async function withdrawProfileChange(
  deps: Deps,
  auth: AuthContext,
  id: string,
  input: VersionOnlyInput,
) {
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    const req = await repo.lockProfileChange(tx, auth.companyId, id);
    if (!req || !auth.employeeId || req.employeeId !== auth.employeeId) throw notFound();
    if (req.status !== 'pending') throw invalidTransition(req.status, 'withdraw');
    const updated = await repo.updateProfileChange(tx, id, input.version, {
      status: 'withdrawn',
      updatedBy: auth.userId,
      updatedAt: now,
    });
    if (!updated) throw versionConflict();
    await withdrawApproval(tx, auth.companyId, subject(id), auth.userId, now);
    await recordAudit(tx, auth.actor, {
      action: 'profile_change.withdrawn',
      category: 'business',
      entityType: 'profile_change_request',
      entityId: id,
      employeeId: req.employeeId,
      metadata: { from: 'pending', to: 'withdrawn' },
    });
  });
  return load(deps, auth, id);
}
