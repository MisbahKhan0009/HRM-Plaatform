import type { AdjustmentStatus, PayrollRunStatus } from '@hrm/contracts';

/** Run actions (DOMAIN-MODEL 5.6, API-CATALOGUE §8). */
export type PayrollRunAction =
  | 'calculate'
  | 'validate'
  | 'submit'
  | 'return'
  | 'approve'
  | 'lock'
  | 'pay'
  | 'mark_paid'
  | 'reconcile'
  | 'publish';

const RUN_TRANSITIONS: Record<
  PayrollRunAction,
  { from: readonly PayrollRunStatus[]; to: PayrollRunStatus | null }
> = {
  // calculated → calculated is the idempotent recalculation (BUSINESS-RULES 6.7)
  calculate: { from: ['draft', 'calculated'], to: 'calculated' },
  // validate re-runs the checks without a state change
  validate: { from: ['calculated', 'submitted'], to: null },
  submit: { from: ['calculated'], to: 'submitted' },
  // returned → draft happens in the same transaction; `to` is the stored end state
  return: { from: ['calculated', 'submitted'], to: 'draft' },
  approve: { from: ['submitted'], to: 'approved' },
  lock: { from: ['approved'], to: 'locked' },
  // recording or cancelling a payment keeps the run locked (partial payment shows exceptions)
  pay: { from: ['locked'], to: null },
  mark_paid: { from: ['locked'], to: 'paid' },
  reconcile: { from: ['paid'], to: 'reconciled' },
  // payslips are published at `locked` or later (DOMAIN-MODEL 5.6)
  publish: { from: ['locked', 'paid', 'reconciled'], to: null },
};

export type RunTransition = { ok: true; to: PayrollRunStatus } | { ok: false };

/**
 * DOMAIN-MODEL 5.6. Whether `action` is allowed from `current`, and the resulting status (unchanged for actions that
 * do not move the run).
 */
export function payrollRunTransition(current: PayrollRunStatus, action: PayrollRunAction): RunTransition {
  const t = RUN_TRANSITIONS[action];
  if (!t.from.includes(current)) return { ok: false };
  return { ok: true, to: t.to ?? current };
}

/** Statuses whose items and lines are frozen (FR-PAY-011; mirrors the database lock guard). */
export const LOCKED_RUN_STATUSES: readonly PayrollRunStatus[] = ['locked', 'paid', 'reconciled'];

export const isRunLocked = (status: PayrollRunStatus) => LOCKED_RUN_STATUSES.includes(status);

export type AdjustmentAction = 'approve' | 'reject' | 'apply';

const ADJUSTMENT_TRANSITIONS: Record<AdjustmentAction, { from: AdjustmentStatus; to: AdjustmentStatus }> = {
  approve: { from: 'pending', to: 'approved' },
  reject: { from: 'pending', to: 'rejected' },
  apply: { from: 'approved', to: 'applied' },
};

/** DOMAIN-MODEL 5.7. The next status, or null when the action is not allowed. */
export function nextAdjustmentStatus(
  current: AdjustmentStatus,
  action: AdjustmentAction,
): AdjustmentStatus | null {
  const t = ADJUSTMENT_TRANSITIONS[action];
  return t.from === current ? t.to : null;
}

/** Self-approval of payroll (D-007): allowed only when the setting permits it and with a justification note. */
export type SelfApprovalCheck =
  | { ok: true; selfApproved: boolean; note: string | null }
  | { ok: false; reason: 'SELF_APPROVAL_FORBIDDEN' | 'SELF_APPROVAL_NOTE_REQUIRED' };

/** Minimum justification length (docs/06-frontend/FORMS-AND-VALIDATION.md §5, enforced by the server). */
export const SELF_APPROVAL_NOTE_MIN_LENGTH = 20;

export function checkSelfApproval(input: {
  isSelf: boolean;
  allowSelfApproval: boolean;
  note: string | null | undefined;
}): SelfApprovalCheck {
  if (!input.isSelf) return { ok: true, selfApproved: false, note: null };
  if (!input.allowSelfApproval) return { ok: false, reason: 'SELF_APPROVAL_FORBIDDEN' };
  const note = input.note?.trim() ?? '';
  if (note.length < SELF_APPROVAL_NOTE_MIN_LENGTH)
    return { ok: false, reason: 'SELF_APPROVAL_NOTE_REQUIRED' };
  return { ok: true, selfApproved: true, note };
}
