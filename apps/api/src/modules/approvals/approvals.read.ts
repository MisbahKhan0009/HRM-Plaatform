import type { ApprovalDetail } from '@hrm/contracts';
import type { AuthContext } from '../../lib/auth-context';
import type { Deps } from '../../lib/deps';
import { notFound } from '../../lib/problem';
import { getSetting } from '../../lib/settings';
import * as repo from './approvals.repository';

/**
 * `GET /approvals/{id}`: visible to the requester, a current or past approver, and `audit.read.all`. The requester
 * does not see approver identities when `approvals.hide_reviewer` is on (FR-ESS-007).
 */
export async function getApprovalDetail(deps: Deps, auth: AuthContext, id: string): Promise<ApprovalDetail> {
  const found = await repo.findDetail(deps.db, auth.companyId, id);
  if (!found) throw notFound();
  const isRequester = found.summary.requester.id === auth.userId;
  const isApprover = found.steps.some(
    (s) =>
      s.approver_user_id === auth.userId ||
      (s.approver_permission !== null && auth.permissions.includes(s.approver_permission as never)),
  );
  if (!isRequester && !isApprover && !auth.can('audit.read.all')) throw notFound();
  const hide =
    isRequester && !isApprover && (await getSetting(deps.db, auth.companyId, 'approvals.hide_reviewer'));
  return {
    ...found.summary,
    steps: found.steps.map((s) => ({
      sequence: s.sequence,
      decision: s.decision,
      approverName: hide ? null : s.approver_name,
      approverPermission: s.approver_permission,
      decidedByName: hide ? null : s.decided_by_name,
      decidedAt: s.decided_at,
      comment: s.comment,
      onBehalf: s.on_behalf,
    })),
  };
}
