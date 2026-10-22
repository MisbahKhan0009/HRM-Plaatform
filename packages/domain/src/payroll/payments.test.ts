import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkClaimExpenseDate } from '../reimbursements/claims';
import { checkPayment, parseCsv, parsePaymentsCsv } from './payments';

describe('checkPayment (PAY-11, D-042)', () => {
  it('accepts exactly the net amount for an unpaid or failed item', () => {
    expect(checkPayment({ net: '24838.71', amount: '24838.71', itemPaymentStatus: 'unpaid' })).toEqual({
      ok: true,
    });
    expect(checkPayment({ net: '24838.71', amount: '24838.71', itemPaymentStatus: 'failed' })).toEqual({
      ok: true,
    });
  });
  it('rejects a different amount (no split payments)', () => {
    expect(checkPayment({ net: '24838.71', amount: '24838.00', itemPaymentStatus: 'unpaid' })).toEqual({
      ok: false,
      reason: 'AMOUNT_MISMATCH',
    });
  });
  it('rejects a second payment for a paid item', () => {
    expect(checkPayment({ net: '10.00', amount: '10.00', itemPaymentStatus: 'paid' })).toMatchObject({
      reason: 'ALREADY_PAID',
    });
  });
  it('rejects a payment for an item with nothing to pay', () => {
    expect(checkPayment({ net: '0.00', amount: '1.00', itemPaymentStatus: 'unpaid' })).toMatchObject({
      reason: 'NOTHING_DUE',
    });
  });
});

describe('parseCsv (RFC 4180)', () => {
  it('handles quotes, doubled quotes, commas and CRLF', () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n1,2,3\n')).toEqual([
      ['a', 'b,c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });
  it('returns null for an unterminated quote', () => {
    expect(parseCsv('a,"b\n')).toBeNull();
  });
  it('round-trips arbitrary fields', () => {
    const cell = fc.string({ maxLength: 8 }).filter((v) => !/[\r\n]/.test(v));
    fc.assert(
      fc.property(
        fc.array(fc.array(cell, { minLength: 2, maxLength: 4 }), { minLength: 1, maxLength: 5 }),
        (rows) => {
          const text = rows.map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(',')).join('\r\n');
          expect(parseCsv(text)).toEqual(rows);
        },
      ),
    );
  });
});

describe('parsePaymentsCsv', () => {
  const header = 'employeeCode,method,amount,paidOn,chequeNumber,reference';
  it('parses valid rows and reports every invalid field', () => {
    const r = parsePaymentsCsv(
      `${header}\nEMP-1,cash,52000.00,2027-04-02,,ACK-0311\nEMP-2,cheque,22500.00,2027-04-02,004512,\nEMP-3,card,0.00,04/02/2027,,`,
    );
    if (!r.ok) throw new Error(r.reason);
    expect(r.rows[0]).toMatchObject({ line: 2, employeeCode: 'EMP-1', reference: 'ACK-0311', errors: [] });
    expect(r.rows[1]).toMatchObject({ chequeNumber: '004512', errors: [] });
    expect(r.rows[2]?.errors.map((e) => e.code)).toEqual([
      'invalid_method',
      'invalid_amount',
      'invalid_date',
    ]);
  });
  it('requires a cheque number for cheques and a reference for cash', () => {
    const r = parsePaymentsCsv(`${header}\nE,cheque,1.00,2027-04-02,,\nF,cash,1.00,2027-04-02,,`);
    if (!r.ok) throw new Error(r.reason);
    expect(r.rows.map((x) => x.errors.map((e) => e.code))).toEqual([
      ['cheque_number_required'],
      ['reference_required'],
    ]);
  });
  it('rejects a bad header, an empty file and too many rows', () => {
    expect(parsePaymentsCsv('code,method\nE,cash')).toEqual({ ok: false, reason: 'BAD_HEADER' });
    expect(parsePaymentsCsv(header)).toEqual({ ok: false, reason: 'EMPTY' });
    expect(parsePaymentsCsv(`${header}\nA,cash,1.00,2027-01-01,,R\nB,cash,1.00,2027-01-01,,R`, 1)).toEqual({
      ok: false,
      reason: 'TOO_MANY_ROWS',
    });
    expect(parsePaymentsCsv(`${header}\n"A,cash`)).toEqual({ ok: false, reason: 'MALFORMED' });
  });
});

describe('checkClaimExpenseDate (reimbursements.max_claim_age_days)', () => {
  it.each([
    ['2026-11-30', 'ok'],
    ['2026-10-01', 'ok'],
    ['2026-09-30', 'TOO_OLD'],
    ['2026-12-01', 'IN_FUTURE'],
  ])('%s with today 2026-11-30 and 60 days -> %s', (date, expected) => {
    const r = checkClaimExpenseDate(date, '2026-11-30', 60);
    expect(r.ok ? 'ok' : r.reason).toBe(expected);
  });
});
