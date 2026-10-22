/**
 * Browser-side document builders (D-037): payslip PDF (pdf-lib) and CSV/XLSX exports.
 * They run in the browser so the Worker stays within its 10 ms CPU budget (ADR-0009).
 * The PDF and XLSX builders land with the payroll and reports modules (Stage 8).
 */

/** Builds RFC 4180 CSV. Cells starting with = + - @ are prefixed with ' to stop formula injection. */
export function toCsv(rows: readonly (readonly (string | number | null)[])[]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          let value = cell === null ? '' : String(cell);
          if (/^[=+\-@\t\r]/.test(value)) value = `'${value}`;
          return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
        })
        .join(','),
    )
    .join('\r\n');
}
