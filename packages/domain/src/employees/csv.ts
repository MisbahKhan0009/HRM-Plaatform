/** Result of parsing CSV text; `rows` excludes nothing (the header is row 0). */
export type CsvParseResult =
  | { ok: true; rows: string[][] }
  | { ok: false; reason: 'UNTERMINATED_QUOTE' | 'TOO_MANY_ROWS' | 'EMPTY'; line: number };

/**
 * Minimal RFC 4180 parser for the employee import (FR-EMP-008): comma separator, double-quoted fields with `""`
 * escapes, CRLF or LF line ends, optional UTF-8 BOM. One pass over the text, so 500 rows stay well inside the
 * Worker's 10 ms CPU budget (ADR-0009). Blank lines are skipped. Stops once more than `maxRows` records are seen.
 */
export function parseCsv(text: string, maxRows: number): CsvParseResult {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  /** Whether the current line had any character (a quoted empty field is a row; an empty line is not). */
  let touched = false;
  let line = 1;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endRow = () => {
    row.push(field);
    field = '';
    if (touched) rows.push(row);
    row = [];
    touched = false;
  };

  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch !== '\n' && ch !== '\r') touched = true;
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
      line++;
      if (rows.length > maxRows) return { ok: false, reason: 'TOO_MANY_ROWS', line };
    } else field += ch;
  }
  if (quoted) return { ok: false, reason: 'UNTERMINATED_QUOTE', line };
  if (touched) endRow();
  if (rows.length > maxRows) return { ok: false, reason: 'TOO_MANY_ROWS', line };
  if (rows.length === 0) return { ok: false, reason: 'EMPTY', line };
  return { ok: true, rows };
}
