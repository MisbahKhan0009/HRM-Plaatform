import { Decimal } from '../money';

export type PaymentCheck =
  | { ok: true }
  | { ok: false; reason: 'AMOUNT_MISMATCH' | 'ALREADY_PAID' | 'NOTHING_DUE' };

/**
 * One payment per item, for exactly the item's net amount (D-042, PAY-11; split payments are not in v1). A failed or
 * cancelled payment does not count, so the item can be paid again with a new payment row.
 */
export function checkPayment(input: {
  net: string;
  amount: string;
  itemPaymentStatus: string;
}): PaymentCheck {
  if (input.itemPaymentStatus === 'paid') return { ok: false, reason: 'ALREADY_PAID' };
  const net = new Decimal(input.net);
  if (!net.greaterThan(0)) return { ok: false, reason: 'NOTHING_DUE' };
  return new Decimal(input.amount).equals(net) ? { ok: true } : { ok: false, reason: 'AMOUNT_MISMATCH' };
}

export const PAYMENT_CSV_COLUMNS = [
  'employeeCode',
  'method',
  'amount',
  'paidOn',
  'chequeNumber',
  'reference',
  'acknowledgedByName',
] as const;

export interface PaymentCsvRow {
  /** 1-based line number in the file (the header is line 1). */
  line: number;
  employeeCode: string;
  method: string;
  amount: string;
  paidOn: string;
  chequeNumber: string | null;
  reference: string | null;
  acknowledgedByName: string | null;
  errors: { code: string; message: string }[];
}

export type PaymentCsvResult =
  | { ok: true; rows: PaymentCsvRow[] }
  | { ok: false; reason: 'EMPTY' | 'BAD_HEADER' | 'TOO_MANY_ROWS' | 'MALFORMED' };

/** RFC 4180 records: quoted fields, doubled quotes, CRLF or LF line ends. Returns null on an unterminated quote. */
export function parseCsvRows(text: string): string[][] | null {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else field += ch;
  }
  if (quoted) return null;
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }
  return records.filter((r) => !(r.length === 1 && r[0]?.trim() === ''));
}

const AMOUNT = /^\d{1,12}\.\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses and checks the payments import file (API-CATALOGUE §8 `payments/import`). The header row must name the
 * columns in `PAYMENT_CSV_COLUMNS` (any order; unknown columns are rejected). Row errors are collected so a dry run can
 * show every problem at once.
 */
export function parsePaymentsCsv(text: string, maxRows = 500): PaymentCsvResult {
  const records = parseCsvRows(text.replace(/^﻿/, ''));
  if (records === null) return { ok: false, reason: 'MALFORMED' };
  const [header, ...body] = records;
  if (!header) return { ok: false, reason: 'EMPTY' };
  const names = header.map((h) => h.trim());
  const known = new Set<string>(PAYMENT_CSV_COLUMNS);
  if (
    names.some((n) => !known.has(n)) ||
    new Set(names).size !== names.length ||
    !['employeeCode', 'method', 'amount', 'paidOn'].every((n) => names.includes(n))
  )
    return { ok: false, reason: 'BAD_HEADER' };
  if (body.length === 0) return { ok: false, reason: 'EMPTY' };
  if (body.length > maxRows) return { ok: false, reason: 'TOO_MANY_ROWS' };

  const rows = body.map((cells, idx): PaymentCsvRow => {
    const get = (name: string) => {
      const i = names.indexOf(name);
      const v = i >= 0 ? (cells[i] ?? '').trim() : '';
      return v === '' ? null : v;
    };
    const row: PaymentCsvRow = {
      line: idx + 2,
      employeeCode: get('employeeCode') ?? '',
      method: get('method') ?? '',
      amount: get('amount') ?? '',
      paidOn: get('paidOn') ?? '',
      chequeNumber: get('chequeNumber'),
      reference: get('reference'),
      acknowledgedByName: get('acknowledgedByName'),
      errors: [],
    };
    if (!row.employeeCode) row.errors.push({ code: 'required', message: 'employeeCode is required.' });
    if (row.method !== 'cash' && row.method !== 'cheque')
      row.errors.push({ code: 'invalid_method', message: 'method must be cash or cheque.' });
    if (!AMOUNT.test(row.amount) || new Decimal(row.amount).isZero())
      row.errors.push({ code: 'invalid_amount', message: 'amount must be a positive amount like 45000.00.' });
    if (!DATE.test(row.paidOn) || Number.isNaN(Date.parse(`${row.paidOn}T00:00:00Z`)))
      row.errors.push({ code: 'invalid_date', message: 'paidOn must be a date like 2026-11-30.' });
    if (row.method === 'cheque' && !row.chequeNumber)
      row.errors.push({ code: 'cheque_number_required', message: 'chequeNumber is required for cheques.' });
    if (row.method === 'cash' && !row.reference)
      row.errors.push({
        code: 'reference_required',
        message: 'reference (cash acknowledgment) is required for cash.',
      });
    return row;
  });
  return { ok: true, rows };
}
