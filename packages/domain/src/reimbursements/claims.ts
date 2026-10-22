import type { ClaimStatus } from '@hrm/contracts';
import { addDays, type IsoDate } from '../dates';

/** Actions an endpoint may take on a claim. `include` and `pay` are payroll-only (FR-REIM-003). */
export type ClaimAction = 'submit' | 'withdraw' | 'approve' | 'reject' | 'include' | 'pay';

const CLAIM_TRANSITIONS: Record<ClaimAction, { from: readonly ClaimStatus[]; to: ClaimStatus }> = {
  submit: { from: ['draft'], to: 'submitted' },
  withdraw: { from: ['submitted'], to: 'withdrawn' },
  approve: { from: ['submitted'], to: 'approved' },
  reject: { from: ['submitted'], to: 'rejected' },
  include: { from: ['approved'], to: 'included' },
  pay: { from: ['included'], to: 'paid' },
};

/** DOMAIN-MODEL 5.5. The next status, or null when the action is not allowed from `current`. */
export function nextClaimStatus(current: ClaimStatus, action: ClaimAction): ClaimStatus | null {
  const t = CLAIM_TRANSITIONS[action];
  return t.from.includes(current) ? t.to : null;
}

/** A claim can be edited or deleted only while it is a draft (FR-REIM-004). */
export const isClaimEditable = (status: ClaimStatus) => status === 'draft';

export type ClaimDateCheck = { ok: true } | { ok: false; reason: 'IN_FUTURE' | 'TOO_OLD' };

/**
 * Expense date rule at submit (BUSINESS-RULES §9 `reimbursements.max_claim_age_days`): the date may not be after
 * today and may not be more than `maxAgeDays` days before today (business dates, Asia/Dhaka).
 */
export function checkClaimExpenseDate(
  expenseDate: IsoDate,
  today: IsoDate,
  maxAgeDays: number,
): ClaimDateCheck {
  if (expenseDate > today) return { ok: false, reason: 'IN_FUTURE' };
  if (expenseDate < addDays(today, -maxAgeDays)) return { ok: false, reason: 'TOO_OLD' };
  return { ok: true };
}
