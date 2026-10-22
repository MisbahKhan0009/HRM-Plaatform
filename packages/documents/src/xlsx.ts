import { strToU8, zipSync } from 'fflate';

/**
 * Browser-side XLSX builder for report exports (D-037, TABLES-AND-LISTS §6). It writes a minimal SpreadsheetML
 * package (one sheet, inline strings, one money format) zipped with fflate, so no spreadsheet library ships to the
 * browser. Money stays a decimal string from the API to the XML: it is never parsed into a JavaScript number
 * (ADR-0006), yet the spreadsheet stores it as a number formatted `#,##0.00`.
 */

/** How a column's cells are written. `money` and `integer` cells are numbers in the sheet; the rest are text. */
export type ColumnType = 'text' | 'money' | 'integer';

export type CellValue = string | number | null | undefined;

export interface ExportColumn<Row> {
  header: string;
  type?: ColumnType;
  /** Approximate width in characters for XLSX. */
  width?: number;
  value: (row: Row) => CellValue;
}

export interface ExportTable<Row> {
  /** Sheet name in XLSX; cut to 31 characters without the characters Excel rejects. */
  sheetName: string;
  columns: readonly ExportColumn<Row>[];
  rows: readonly Row[];
}

/** Text that a spreadsheet would read as a formula gets a leading `'` (TABLES-AND-LISTS §6). */
export function neutraliseFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

const DECIMAL = /^-?\d{1,15}(\.\d{1,4})?$/;

/** Header row plus one array per row, in column order; the shape both CSV and XLSX are built from. */
export function tableMatrix<Row>(table: ExportTable<Row>): (string | null)[][] {
  return [
    table.columns.map((c) => c.header),
    ...table.rows.map((row) =>
      table.columns.map((c) => {
        const v = c.value(row);
        return v === null || v === undefined ? null : String(v);
      }),
    ),
  ];
}

// XML 1.0 forbids most control characters; drop them rather than produce a file Excel refuses to open.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

function xmlEscape(value: string): string {
  return value
    .replace(INVALID_XML, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function safeSheetName(name: string): string {
  const clean = name.replace(/[[\]:*?/\\]/g, ' ').trim();
  return (clean || 'Sheet1').slice(0, 31);
}

// Style indexes in styles.xml: 0 default, 1 bold header, 2 money (#,##0.00), 3 integer (0).
const STYLE_HEADER = 1;
const STYLE_MONEY = 2;
const STYLE_INTEGER = 3;

function cellXml(ref: string, value: string | null, type: ColumnType, header: boolean): string {
  if (value === null || value === '') return '';
  if (!header && type !== 'text' && DECIMAL.test(value)) {
    const style = type === 'money' ? STYLE_MONEY : STYLE_INTEGER;
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  }
  const text = xmlEscape(neutraliseFormula(value));
  const style = header ? ` s="${STYLE_HEADER}"` : '';
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${text}</t></is></c>`;
}

function sheetXml<Row>(table: ExportTable<Row>): string {
  const matrix = tableMatrix(table);
  const cols = table.columns
    .map(
      (c, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? Math.max(10, c.header.length + 2)}" customWidth="1"/>`,
    )
    .join('');
  const rows = matrix
    .map((cells, r) => {
      const xml = cells
        .map((v, c) => cellXml(`${columnName(c)}${r + 1}`, v, table.columns[c]?.type ?? 'text', r === 0))
        .join('');
      return `<row r="${r + 1}">${xml}</row>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${rows}</sheetData>` +
    '</worksheet>'
  );
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '</Types>';

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>';

const WORKBOOK_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>';

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function workbookXml(sheetName: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${xmlEscape(safeSheetName(sheetName))}" sheetId="1" r:id="rId1"/></sheets>` +
    '</workbook>'
  );
}

/** Builds an `.xlsx` file (one sheet) from a column definition and rows. */
export function toXlsx<Row>(table: ExportTable<Row>): Uint8Array {
  // A fixed timestamp keeps the output byte-identical for the same input.
  const mtime = new Date(Date.UTC(2026, 0, 1));
  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(ROOT_RELS),
      'xl/workbook.xml': strToU8(workbookXml(table.sheetName)),
      'xl/_rels/workbook.xml.rels': strToU8(WORKBOOK_RELS),
      'xl/styles.xml': strToU8(STYLES),
      'xl/worksheets/sheet1.xml': strToU8(sheetXml(table)),
    },
    { level: 6, mtime },
  );
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
