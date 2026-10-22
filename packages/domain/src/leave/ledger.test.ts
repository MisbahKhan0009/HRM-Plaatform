import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Decimal } from '../money';
import {
  applyPostings,
  availableOf,
  balanceDelta,
  canConsume,
  type LeaveAction,
  type LeaveRequestStatus,
  type LedgerPosting,
  nextLeaveStatus,
  postingsFor,
  zeroBalance,
} from './ledger';

const STATUSES: LeaveRequestStatus[] = [
  'draft',
  'pending',
  'approved',
  'rejected',
  'withdrawn',
  'cancellation_pending',
  'cancelled',
];
const ACTIONS: Exclude<LeaveAction, 'create'>[] = [
  'withdraw',
  'approve',
  'reject',
  'request_cancellation',
  'approve_cancellation',
  'reject_cancellation',
];

describe('nextLeaveStatus (DOMAIN-MODEL 5.3)', () => {
  const allowed: Record<string, LeaveRequestStatus> = {
    'pending:withdraw': 'withdrawn',
    'pending:approve': 'approved',
    'pending:reject': 'rejected',
    'approved:request_cancellation': 'cancellation_pending',
    'cancellation_pending:approve_cancellation': 'cancelled',
    'cancellation_pending:reject_cancellation': 'approved',
  };
  for (const status of STATUSES) {
    for (const action of ACTIONS) {
      const expected = allowed[`${status}:${action}`] ?? null;
      it(`${status} --${action}--> ${expected ?? 'rejected'}`, () => {
        expect(nextLeaveStatus(status, action)).toBe(expected);
      });
    }
  }
  it('create always yields pending (draft is not exposed in v1)', () => {
    expect(postingsFor('create', 1)[0]?.type).toBe('reservation');
  });
});

describe('postingsFor and balanceDelta (BUSINESS-RULES 4.1)', () => {
  const after = (action: LeaveAction, units: string) => {
    const b = applyPostings(zeroBalance(), postingsFor(action, units));
    return {
      entitled: b.entitled.toString(),
      used: b.used.toString(),
      reserved: b.reserved.toString(),
      adjusted: b.adjusted.toString(),
    };
  };
  it.each([
    ['create posts reservation -u: reserved += u', 'create', { reserved: '2' }],
    ['withdraw posts reservation_release +u: reserved -= u', 'withdraw', { reserved: '-2' }],
    ['reject posts reservation_release +u: reserved -= u', 'reject', { reserved: '-2' }],
    ['approve posts release + usage: reserved -= u, used += u', 'approve', { reserved: '-2', used: '2' }],
    ['request_cancellation posts nothing', 'request_cancellation', {}],
    ['approve_cancellation posts reversal +u: used -= u', 'approve_cancellation', { used: '-2' }],
    ['reject_cancellation posts nothing', 'reject_cancellation', {}],
  ] as const)('%s', (_rule, action, expected) => {
    expect(after(action, '2')).toEqual({
      entitled: '0',
      used: '0',
      reserved: '0',
      adjusted: '0',
      ...expected,
    });
  });

  it.each([
    ['grant', '10', 'entitled'],
    ['accrual', '0.5', 'entitled'],
    ['carry_forward', '3', 'entitled'],
    ['adjustment', '-1.5', 'adjusted'],
    ['adjustment', '1', 'adjusted'],
    ['expiry', '-4', 'adjusted'],
  ] as const)('%s %s moves %s', (type, amount, column) => {
    expect(balanceDelta(type, amount)[column].toString()).toBe(new Decimal(amount).toString());
  });

  it('refuses consumption below zero unless the policy allows a negative balance', () => {
    expect(canConsume('1.5', '2', false)).toBe(false);
    expect(canConsume('2', '2', false)).toBe(true);
    expect(canConsume('1.5', '2', true)).toBe(true);
  });
});

type Op =
  | { kind: 'submit'; units: number }
  | { kind: 'grant'; amount: number }
  | { kind: 'adjust'; amount: number }
  | { kind: Exclude<LeaveAction, 'create'>; index: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('submit' as const), units: fc.integer({ min: 1, max: 10 }) }),
  fc.record({ kind: fc.constant('grant' as const), amount: fc.integer({ min: 1, max: 28 }) }),
  fc.record({ kind: fc.constant('adjust' as const), amount: fc.integer({ min: -10, max: 10 }) }),
  fc.record({ kind: fc.constantFrom(...ACTIONS), index: fc.nat(20) }),
);

describe('ledger properties (TESTING-STRATEGY §6)', () => {
  it('available equals the sum of ledger entries and never goes below zero without a policy exception', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 60 }), fc.boolean(), (ops, allowNegative) => {
        let balance = zeroBalance();
        const ledger: LedgerPosting[] = [];
        const requests: { status: LeaveRequestStatus; units: Decimal }[] = [];
        const post = (postings: LedgerPosting[]) => {
          ledger.push(...postings);
          balance = applyPostings(balance, postings);
        };
        for (const op of ops) {
          if (op.kind === 'grant') post([{ type: 'grant', amount: new Decimal(op.amount).div(2) }]);
          else if (op.kind === 'adjust') {
            // HR adjustments follow the same floor as requests (service: INSUFFICIENT_BALANCE).
            const a = new Decimal(op.amount).div(2);
            if (a.isZero() || !canConsume(availableOf(balance), a.neg(), allowNegative)) continue;
            post([{ type: 'adjustment', amount: a }]);
          } else if (op.kind === 'submit') {
            const u = new Decimal(op.units).div(2);
            if (!canConsume(availableOf(balance), u, allowNegative)) continue;
            post(postingsFor('create', u));
            requests.push({ status: 'pending', units: u });
          } else {
            const req = requests[op.index % Math.max(requests.length, 1)];
            if (!req) continue;
            const next = nextLeaveStatus(req.status, op.kind);
            if (!next) continue; // rejected transitions leave the record and ledger unchanged
            post(postingsFor(op.kind, req.units));
            req.status = next;
          }
          const sum = ledger.reduce((s, p) => s.plus(p.amount), new Decimal(0));
          if (!availableOf(balance).eq(sum)) return false;
          if (!allowNegative && availableOf(balance).lt(0)) return false;
          if (balance.reserved.lt(0) || balance.used.lt(0)) return false;
        }
        const open = requests
          .filter((r) => r.status === 'pending')
          .reduce((s, r) => s.plus(r.units), new Decimal(0));
        const consumed = requests
          .filter((r) => r.status === 'approved' || r.status === 'cancellation_pending')
          .reduce((s, r) => s.plus(r.units), new Decimal(0));
        return balance.reserved.eq(open) && balance.used.eq(consumed);
      }),
    );
  });
});
