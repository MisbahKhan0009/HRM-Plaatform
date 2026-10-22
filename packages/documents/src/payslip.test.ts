import type { PayslipData } from '@hrm/contracts';
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream, type PDFRef } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildPayslipPdf, dhakaDate, formatPdfDate, formatPdfMoney, payslipFileName } from './payslip';

// Fixed snapshot (fake data only, D-043).
const SNAPSHOT: PayslipData = {
  id: '0190a000-0000-7000-8000-000000000001',
  company: { name: 'Big-Matrix Solutions', legalName: 'Big-Matrix Solutions Ltd.', address: 'Dhaka' },
  employee: {
    id: '0190a000-0000-7000-8000-000000000002',
    employeeCode: 'EMP-0014',
    name: 'Nusrat Jahan',
    department: 'Engineering',
    position: 'Software engineer',
    joiningDate: '2024-01-01',
    separationDate: null,
  },
  period: {
    id: '0190a000-0000-7000-8000-000000000003',
    year: 2026,
    month: 9,
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    daysInPeriod: 30,
  },
  runNumber: 'PR-2026-09-01',
  daysEmployed: 30,
  lines: [
    {
      kind: 'earning',
      code: 'base_salary',
      label: 'Base salary',
      amount: { amount: '65000.00', currency: 'BDT' },
    },
    {
      kind: 'earning',
      code: 'reimbursement',
      label: 'Transport reimbursement',
      amount: { amount: '1850.00', currency: 'BDT' },
    },
    {
      kind: 'deduction',
      code: 'deduction',
      label: 'Salary advance',
      amount: { amount: '3000.00', currency: 'BDT' },
    },
  ],
  totals: {
    gross: { amount: '66850.00', currency: 'BDT' },
    deductions: { amount: '3000.00', currency: 'BDT' },
    net: { amount: '63850.00', currency: 'BDT' },
  },
  ruleVersion: 'payroll-v1',
  paymentStatus: 'paid',
  publishedAt: '2026-09-30T10:00:00.000Z',
  firstViewedAt: null,
};

// 1×1 transparent PNG, standing in for the Paper lockup.
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

/** Text shown by `<hex> Tj` operators on every page, in drawing order. */
async function extractText(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref as PDFRef))
        : [contents];
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue;
      const source = new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
      for (const m of source.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
        const hex = m[1] ?? '';
        let s = '';
        for (let i = 0; i < hex.length; i += 2)
          s += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
        out.push(s);
      }
    }
  }
  return out;
}

describe('buildPayslipPdf', () => {
  it('renders stable text content from a fixed snapshot', async () => {
    const text = await extractText(await buildPayslipPdf(SNAPSHOT, { logoPng: PNG }));
    expect(text).toMatchInlineSnapshot(`
      [
        "Big-Matrix Solutions Ltd.",
        "Dhaka",
        "PAYSLIP",
        "September 2026",
        "1 Sep 2026 to 30 Sep 2026 - PR-2026-09-01",
        "Employee",
        "Nusrat Jahan",
        "Days paid",
        "30 of 30",
        "Code",
        "EMP-0014",
        "Payment",
        "Paid",
        "Department",
        "Engineering",
        "Published",
        "30 Sep 2026",
        "Position",
        "Software engineer",
        "Currency",
        "BDT",
        "Joined",
        "1 Jan 2024",
        "EARNINGS",
        "AMOUNT",
        "Base salary",
        "BDT 65,000.00",
        "Transport reimbursement",
        "BDT 1,850.00",
        "Total earnings",
        "BDT 66,850.00",
        "DEDUCTIONS",
        "AMOUNT",
        "Salary advance",
        "BDT 3,000.00",
        "Total deductions",
        "BDT 3,000.00",
        "Net pay",
        "BDT 63,850.00",
        "Generated from the locked payroll run PR-2026-09-01 (calculation rules payroll-v1).",
        "Amounts in Bangladeshi taka (BDT).",
        "Page 1 of 1",
      ]
    `);
  });

  it('writes the company name when no logo is given and shows empty deductions', async () => {
    const text = await extractText(
      await buildPayslipPdf({
        ...SNAPSHOT,
        lines: SNAPSHOT.lines.filter((l) => l.kind === 'earning'),
        totals: { ...SNAPSHOT.totals, deductions: { amount: '0.00', currency: 'BDT' } },
      }),
    );
    expect(text[0]).toBe('Big-Matrix Solutions');
    expect(text).toContain('No deductions this month');
    expect(text).toContain('BDT 0.00');
  });

  it('replaces characters the standard font cannot draw instead of failing', async () => {
    const text = await extractText(
      await buildPayslipPdf({ ...SNAPSHOT, employee: { ...SNAPSHOT.employee, name: 'নুসরাত Jahan' } }),
    );
    expect(text).toContain('?????? Jahan');
  });
});

describe('formatting helpers', () => {
  it('groups money as text with an ASCII currency code', () => {
    expect(formatPdfMoney('2882686.43')).toBe('BDT 2,882,686.43');
    expect(formatPdfMoney('-3000.00')).toBe('-BDT 3,000.00');
    expect(formatPdfMoney('999999999999.99')).toBe('BDT 999,999,999,999.99');
  });
  it('formats dates and the file name', () => {
    expect(formatPdfDate('2026-10-02')).toBe('2 Oct 2026');
    expect(payslipFileName(SNAPSHOT)).toBe('payslip-2026-09-EMP-0014.pdf');
    expect(dhakaDate('2026-10-22T23:24:00.000Z')).toBe('2026-10-23');
  });
});
