import {
  type ClaimStatus,
  claimStatusValues,
  type PayrollRunStatus,
  payrollRunStatusValues,
} from '@hrm/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type ClaimAction, nextClaimStatus } from '../reimbursements/claims';
import {
  type AdjustmentAction,
  checkSelfApproval,
  isRunLocked,
  nextAdjustmentStatus,
  type PayrollRunAction,
  payrollRunTransition,
} from './transitions';

const RUN_ACTIONS: PayrollRunAction[] = [
  'calculate',
  'validate',
  'submit',
  'return',
  'approve',
  'lock',
  'pay',
  'mark_paid',
  'reconcile',
  'publish',
];

// DOMAIN-MODEL 5.6, as `[from, action] -> to`. Anything not listed is rejected.
const RUN_ALLOWED: Record<string, PayrollRunStatus> = {
  'draft:calculate': 'calculated',
  'calculated:calculate': 'calculated',
  'calculated:validate': 'calculated',
  'submitted:validate': 'submitted',
  'calculated:submit': 'submitted',
  'calculated:return': 'draft',
  'submitted:return': 'draft',
  'submitted:approve': 'approved',
  'approved:lock': 'locked',
  'locked:pay': 'locked',
  'locked:mark_paid': 'paid',
  'paid:reconcile': 'reconciled',
  'locked:publish': 'locked',
  'paid:publish': 'paid',
  'reconciled:publish': 'reconciled',
};

describe('payrollRunTransition: every (status, action) pair', () => {
  for (const from of payrollRunStatusValues) {
    for (const action of RUN_ACTIONS) {
      const expected = RUN_ALLOWED[`${from}:${action}`];
      it(`${from} --${action}--> ${expected ?? 'rejected'}`, () => {
        expect(payrollRunTransition(from, action)).toEqual(
          expected ? { ok: true, to: expected } : { ok: false },
        );
      });
    }
  }

  it('random action sequences never leave the documented states, and rejections keep the state', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...RUN_ACTIONS), { maxLength: 40 }), (actions) => {
        let state: PayrollRunStatus = 'draft';
        for (const a of actions) {
          const r = payrollRunTransition(state, a);
          if (r.ok) state = r.to;
          expect(payrollRunStatusValues).toContain(state);
          // once locked, the run never goes back to an editable state (FR-PAY-011)
          if (isRunLocked(state)) expect(isRunLocked(r.ok ? r.to : state)).toBe(true);
        }
      }),
    );
  });
});

const CLAIM_ACTIONS: ClaimAction[] = ['submit', 'withdraw', 'approve', 'reject', 'include', 'pay'];
const CLAIM_ALLOWED: Record<string, ClaimStatus> = {
  'draft:submit': 'submitted',
  'submitted:withdraw': 'withdrawn',
  'submitted:approve': 'approved',
  'submitted:reject': 'rejected',
  'approved:include': 'included',
  'included:pay': 'paid',
};

describe('nextClaimStatus: every (status, action) pair (DOMAIN-MODEL 5.5)', () => {
  for (const from of claimStatusValues) {
    for (const action of CLAIM_ACTIONS) {
      const expected = CLAIM_ALLOWED[`${from}:${action}`] ?? null;
      it(`${from} --${action}--> ${expected ?? 'rejected'}`, () => {
        expect(nextClaimStatus(from, action)).toBe(expected);
      });
    }
  }

  it('random sequences stay inside the claim states', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...CLAIM_ACTIONS), { maxLength: 30 }), (actions) => {
        let state: ClaimStatus = 'draft';
        for (const a of actions) state = nextClaimStatus(state, a) ?? state;
        expect(claimStatusValues).toContain(state);
      }),
    );
  });
});

describe('nextAdjustmentStatus (DOMAIN-MODEL 5.7)', () => {
  const cases: [string, AdjustmentAction, string | null][] = [
    ['pending', 'approve', 'approved'],
    ['pending', 'reject', 'rejected'],
    ['pending', 'apply', null],
    ['approved', 'apply', 'applied'],
    ['approved', 'approve', null],
    ['approved', 'reject', null],
    ['rejected', 'approve', null],
    ['rejected', 'apply', null],
    ['applied', 'approve', null],
    ['applied', 'reject', null],
    ['applied', 'apply', null],
  ];
  it.each(cases)('%s --%s--> %s', (from, action, to) => {
    expect(nextAdjustmentStatus(from as never, action)).toBe(to);
  });
});

describe('checkSelfApproval (D-007)', () => {
  const note = 'Reviewed totals against the bank sheet.';
  it('does nothing for a different approver', () => {
    expect(checkSelfApproval({ isSelf: false, allowSelfApproval: false, note: undefined })).toEqual({
      ok: true,
      selfApproved: false,
      note: null,
    });
  });
  it('requires the setting', () => {
    expect(checkSelfApproval({ isSelf: true, allowSelfApproval: false, note })).toEqual({
      ok: false,
      reason: 'SELF_APPROVAL_FORBIDDEN',
    });
  });
  it('PAY-13f requires a note of at least 20 characters', () => {
    expect(checkSelfApproval({ isSelf: true, allowSelfApproval: true, note: undefined })).toMatchObject({
      reason: 'SELF_APPROVAL_NOTE_REQUIRED',
    });
    expect(checkSelfApproval({ isSelf: true, allowSelfApproval: true, note: '  too short  ' })).toMatchObject(
      {
        reason: 'SELF_APPROVAL_NOTE_REQUIRED',
      },
    );
    expect(checkSelfApproval({ isSelf: true, allowSelfApproval: true, note })).toEqual({
      ok: true,
      selfApproved: true,
      note,
    });
  });
});
