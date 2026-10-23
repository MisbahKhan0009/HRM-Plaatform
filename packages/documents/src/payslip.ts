import type { PayslipData } from '@hrm/contracts';
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib';

/**
 * Payslip PDF built in the browser from the immutable `PayslipData` snapshot (D-037, ADR-0006, SCREEN-INVENTORY 6.2).
 * The web app imports this module dynamically at click time so pdf-lib never loads with a route.
 *
 * Fonts: the PDF standard Helvetica (an Arial-like face) needs no font file, but its WinAnsi encoding has no `৳`, so
 * money is written as `BDT 45,000.00`. Characters outside WinAnsi (for example Bangla names) are replaced with `?`
 * until an embedded Unicode font is chosen.
 */

export interface PayslipPdfOptions {
  /** The Paper-theme lockup as PNG bytes (`/logo-paper.png`); omitted, the company name stands alone. */
  logoPng?: Uint8Array | ArrayBuffer;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

/** `"45000.00"` → `BDT 45,000.00`. Grouped as text: money never becomes a JS number (ADR-0006). */
export function formatPdfMoney(amount: string): string {
  const negative = amount.startsWith('-');
  const [intPart = '0', frac = '00'] = (negative ? amount.slice(1) : amount).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}BDT ${grouped}.${frac.padEnd(2, '0').slice(0, 2)}`;
}

/** `2026-10-22` → `22 Oct 2026`. */
export function formatPdfDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${Number(d)} ${SHORT_MONTHS[Number(m) - 1] ?? ''} ${y}`;
}

/** The Asia/Dhaka business date of a UTC timestamp (`2026-10-22T23:24:00Z` → `2026-10-23`). */
export const dhakaDate = (instant: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));

export const payslipMonth = (year: number, month: number) => `${MONTHS[month - 1] ?? ''} ${year}`;

/** `payslip-2026-10-EMP-0014.pdf` */
export const payslipFileName = (data: PayslipData) =>
  `payslip-${data.period.year}-${String(data.period.month).padStart(2, '0')}-${data.employee.employeeCode}.pdf`;

const PAYMENT_STATUS: Record<PayslipData['paymentStatus'], string> = {
  unpaid: 'Unpaid',
  paid: 'Paid',
  failed: 'Payment failed',
  cancelled: 'Payment cancelled',
};

/** `Cheque No. 004517` or `Cash` once paid; otherwise the item's payment status. */
export function paymentLabel(data: PayslipData): string {
  const p = data.payment;
  if (!p) return PAYMENT_STATUS[data.paymentStatus];
  return p.method === 'cheque' ? `Cheque No. ${p.chequeNumber ?? ''}`.trim() : 'Cash';
}

/** Keeps printable ASCII and Latin-1; anything WinAnsi Helvetica cannot draw becomes `?`. */
function safe(text: string): string {
  return text
    .replace(/[‒-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^ -~ -ÿ]/g, '?');
}

const INK = rgb(0.07, 0.07, 0.08);
const MUTED = rgb(0.38, 0.38, 0.42);
const LINE = rgb(0.82, 0.82, 0.85);
const ACCENT = rgb(0.86, 0.15, 0.15);

interface Ctx {
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
}

const MARGIN = 48;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const RIGHT = PAGE_W - MARGIN;

function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: 'left' | 'right' } = {},
) {
  const font = opts.bold ? ctx.bold : ctx.regular;
  const size = opts.size ?? 10;
  const s = safe(value);
  const width = font.widthOfTextAtSize(s, size);
  ctx.page.drawText(s, {
    x: opts.align === 'right' ? x - width : x,
    y,
    size,
    font,
    color: opts.color ?? INK,
  });
}

/** Shortens text with an ellipsis so it fits `maxWidth`. */
function fit(font: PDFFont, value: string, size: number, maxWidth: number) {
  let s = safe(value);
  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > maxWidth) s = s.slice(0, -1);
  return `${s}...`;
}

function rule(ctx: Ctx, y: number, color = LINE, thickness = 0.75) {
  ctx.page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness, color });
}

function lineTable(
  ctx: Ctx,
  y: number,
  heading: string,
  lines: PayslipData['lines'],
  total: { label: string; amount: string },
  empty: string,
): number {
  text(ctx, heading.toUpperCase(), MARGIN, y, { size: 8, bold: true, color: MUTED });
  text(ctx, 'AMOUNT', RIGHT, y, { size: 8, bold: true, color: MUTED, align: 'right' });
  y -= 8;
  rule(ctx, y);
  y -= 16;
  if (!lines.length) {
    text(ctx, empty, MARGIN, y, { color: MUTED });
    text(ctx, formatPdfMoney('0.00'), RIGHT, y, { align: 'right' });
    y -= 18;
  }
  for (const line of lines) {
    const amount = formatPdfMoney(line.amount.amount);
    const labelWidth = RIGHT - MARGIN - ctx.regular.widthOfTextAtSize(amount, 10) - 24;
    ctx.page.drawText(fit(ctx.regular, line.label, 10, labelWidth), {
      x: MARGIN,
      y,
      size: 10,
      font: ctx.regular,
      color: INK,
    });
    text(ctx, amount, RIGHT, y, { align: 'right' });
    y -= 18;
  }
  rule(ctx, y + 8);
  y -= 8;
  text(ctx, total.label, MARGIN, y, { bold: true });
  text(ctx, formatPdfMoney(total.amount), RIGHT, y, { bold: true, align: 'right' });
  return y - 30;
}

/** Builds the one-page A4 payslip. Same input, same text content (TESTING-STRATEGY §2). */
export async function buildPayslipPdf(
  data: PayslipData,
  options: PayslipPdfOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const month = payslipMonth(data.period.year, data.period.month);
  doc.setTitle(safe(`Payslip ${month} - ${data.employee.name}`));
  doc.setAuthor(safe(data.company.name));
  doc.setSubject(safe(`Payslip ${data.runNumber}`));
  doc.setCreator('Big-Matrix HRM');
  doc.setProducer('Big-Matrix HRM');
  const published = new Date(data.publishedAt);
  doc.setCreationDate(published);
  doc.setModificationDate(published);

  const page = doc.addPage([PAGE_W, PAGE_H]);
  const ctx: Ctx = {
    page,
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  // Header: Paper lockup (or the company name), company details on the right.
  let y = PAGE_H - MARGIN;
  if (options.logoPng) {
    const logo = await doc.embedPng(options.logoPng);
    const height = 30;
    const width = (logo.width / logo.height) * height;
    page.drawImage(logo, { x: MARGIN, y: y - height, width, height });
  } else {
    text(ctx, data.company.name, MARGIN, y - 20, { size: 16, bold: true });
  }
  text(ctx, data.company.legalName ?? data.company.name, RIGHT, y - 8, { bold: true, align: 'right' });
  if (data.company.address) {
    const address = fit(ctx.regular, data.company.address, 9, 260);
    text(ctx, address, RIGHT, y - 22, { size: 9, color: MUTED, align: 'right' });
  }
  y -= 48;
  page.drawRectangle({ x: MARGIN, y, width: 24, height: 2, color: ACCENT });
  y -= 30;

  text(ctx, 'PAYSLIP', MARGIN, y, { size: 9, bold: true, color: MUTED });
  y -= 24;
  text(ctx, month, MARGIN, y, { size: 22, bold: true });
  y -= 18;
  text(
    ctx,
    `${formatPdfDate(data.period.startDate)} to ${formatPdfDate(data.period.endDate)} - ${data.runNumber}`,
    MARGIN,
    y,
    { color: MUTED },
  );
  y -= 30;

  // Employee and payment details in two columns.
  const left: [string, string][] = [
    ['Employee', data.employee.name],
    ['Code', data.employee.employeeCode],
    ['Department', data.employee.department ?? '-'],
    ['Position', data.employee.position ?? '-'],
  ];
  const right: [string, string][] = [
    ['Days paid', `${data.daysEmployed} of ${data.period.daysInPeriod}`],
    ['Payment', paymentLabel(data)],
  ];
  if (data.payment) right.push(['Paid on', formatPdfDate(data.payment.paidOn)]);
  right.push(['Published', formatPdfDate(dhakaDate(data.publishedAt))], ['Currency', 'BDT']);
  if (data.employee.joiningDate) right.push(['Joined', formatPdfDate(data.employee.joiningDate)]);
  if (data.employee.separationDate) right.push(['Left', formatPdfDate(data.employee.separationDate)]);
  rule(ctx, y + 12);
  const col2 = MARGIN + (RIGHT - MARGIN) / 2 + 8;
  const rows = Math.max(left.length, right.length);
  for (let i = 0; i < rows; i++) {
    const l = left[i];
    const r = right[i];
    if (l) {
      text(ctx, l[0], MARGIN, y - 4, { size: 9, color: MUTED });
      page.drawText(fit(ctx.regular, l[1], 10, col2 - MARGIN - 100), {
        x: MARGIN + 80,
        y: y - 4,
        size: 10,
        font: ctx.regular,
        color: INK,
      });
    }
    if (r) {
      text(ctx, r[0], col2, y - 4, { size: 9, color: MUTED });
      text(ctx, r[1], col2 + 80, y - 4);
    }
    y -= 18;
  }
  rule(ctx, y + 4);
  y -= 28;

  const sorted = (kind: 'earning' | 'deduction') => data.lines.filter((l) => l.kind === kind);
  y = lineTable(
    ctx,
    y,
    'Earnings',
    sorted('earning'),
    { label: 'Total earnings', amount: data.totals.gross.amount },
    'No earnings this month',
  );
  y = lineTable(
    ctx,
    y,
    'Deductions',
    sorted('deduction'),
    { label: 'Total deductions', amount: data.totals.deductions.amount },
    'No deductions this month',
  );

  // Net pay band.
  page.drawRectangle({
    x: MARGIN,
    y: y - 22,
    width: RIGHT - MARGIN,
    height: 44,
    borderColor: INK,
    borderWidth: 1,
  });
  text(ctx, 'Net pay', MARGIN + 14, y - 4, { size: 12, bold: true });
  text(ctx, formatPdfMoney(data.totals.net.amount), RIGHT - 14, y - 5, {
    size: 16,
    bold: true,
    align: 'right',
  });

  // Footer.
  text(
    ctx,
    `Generated from the locked payroll run ${data.runNumber} (calculation rules ${data.ruleVersion}).`,
    MARGIN,
    MARGIN + 12,
    { size: 8, color: MUTED },
  );
  text(ctx, 'Amounts in Bangladeshi taka (BDT).', MARGIN, MARGIN, { size: 8, color: MUTED });
  text(ctx, 'Page 1 of 1', RIGHT, MARGIN, { size: 8, color: MUTED, align: 'right' });

  return doc.save({ useObjectStreams: false });
}
