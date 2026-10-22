import { Decimal, type DecimalValue } from '../money';

export type LeaveLedgerType =
  | 'grant'
  | 'accrual'
  | 'reservation'
  | 'reservation_release'
  | 'usage'
  | 'adjustment'
  | 'reversal'
  | 'carry_forward'
  | 'expiry';

export type LeaveRequestStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'withdrawn'
  | 'cancellation_pending'
  | 'cancelled';

/** Request actions with ledger or status effects (DOMAIN-MODEL 5.3). */
export type LeaveAction =
  | 'create'
  | 'withdraw'
  | 'approve'
  | 'reject'
  | 'request_cancellation'
  | 'approve_cancellation'
  | 'reject_cancellation';

const TRANSITIONS: Record<LeaveAction, { from: readonly LeaveRequestStatus[]; to: LeaveRequestStatus }> = {
  create: { from: [], to: 'pending' },
  withdraw: { from: ['pending'], to: 'withdrawn' },
  approve: { from: ['pending'], to: 'approved' },
  reject: { from: ['pending'], to: 'rejected' },
  request_cancellation: { from: ['approved'], to: 'cancellation_pending' },
  approve_cancellation: { from: ['cancellation_pending'], to: 'cancelled' },
  reject_cancellation: { from: ['cancellation_pending'], to: 'approved' },
};

/** DOMAIN-MODEL 5.3. The next status, or null when the action is not allowed from `current`. */
export function nextLeaveStatus(current: LeaveRequestStatus, action: LeaveAction): LeaveRequestStatus | null {
  const t = TRANSITIONS[action];
  return t.from.includes(current) ? t.to : null;
}

export interface LedgerPosting {
  type: LeaveLedgerType;
  amount: Decimal;
}

/** BUSINESS-RULES 4.1: signed ledger entries a request transition posts for `units`. */
export function postingsFor(action: LeaveAction, units: DecimalValue): LedgerPosting[] {
  const u = new Decimal(units);
  switch (action) {
    case 'create':
      return [{ type: 'reservation', amount: u.neg() }];
    case 'withdraw':
    case 'reject':
      return [{ type: 'reservation_release', amount: u }];
    case 'approve':
      return [
        { type: 'reservation_release', amount: u },
        { type: 'usage', amount: u.neg() },
      ];
    case 'approve_cancellation':
      return [{ type: 'reversal', amount: u }];
    case 'request_cancellation':
    case 'reject_cancellation':
      return [];
  }
}

export interface BalanceColumns {
  entitled: Decimal;
  used: Decimal;
  reserved: Decimal;
  adjusted: Decimal;
}

export const zeroBalance = (): BalanceColumns => ({
  entitled: new Decimal(0),
  used: new Decimal(0),
  reserved: new Decimal(0),
  adjusted: new Decimal(0),
});

/**
 * BUSINESS-RULES 4.1: how one signed entry moves the `leave_balances` projection. Each mapping keeps
 * `available = entitled - used - reserved + adjusted` equal to the sum of ledger amounts.
 */
export function balanceDelta(type: LeaveLedgerType, amount: DecimalValue): BalanceColumns {
  const a = new Decimal(amount);
  const d = zeroBalance();
  switch (type) {
    case 'grant':
    case 'accrual':
    case 'carry_forward':
      d.entitled = a;
      break;
    case 'reservation':
    case 'reservation_release':
      d.reserved = a.neg();
      break;
    case 'usage':
    case 'reversal':
      d.used = a.neg();
      break;
    case 'adjustment':
    case 'expiry':
      d.adjusted = a;
      break;
  }
  return d;
}

export function applyPostings(balance: BalanceColumns, postings: readonly LedgerPosting[]): BalanceColumns {
  return postings.reduce((b, p) => {
    const d = balanceDelta(p.type, p.amount);
    return {
      entitled: b.entitled.plus(d.entitled),
      used: b.used.plus(d.used),
      reserved: b.reserved.plus(d.reserved),
      adjusted: b.adjusted.plus(d.adjusted),
    };
  }, balance);
}

/** BUSINESS-RULES 4.1: `available = entitled - used - reserved + adjusted`. */
export function availableOf(b: BalanceColumns): Decimal {
  return b.entitled.minus(b.used).minus(b.reserved).plus(b.adjusted);
}

/**
 * BUSINESS-RULES 4.2 step 2: a request (or negative adjustment) that would take `available` below zero is refused
 * unless the policy allows a negative balance.
 */
export function canConsume(available: DecimalValue, units: DecimalValue, allowNegative: boolean): boolean {
  return allowNegative || new Decimal(available).minus(units).gte(0);
}

/** Leave quantities on the wire: decimal strings with 2 places (API-STANDARDS §3). */
export function toLeaveQty(value: DecimalValue): string {
  return new Decimal(value).toFixed(2);
}
