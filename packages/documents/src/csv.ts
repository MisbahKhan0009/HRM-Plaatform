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
