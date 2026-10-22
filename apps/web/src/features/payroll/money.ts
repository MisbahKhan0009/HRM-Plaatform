/**
 * Exact sum of decimal money strings in integer paisa (BigInt), for confirmation summaries only; the server's totals
 * stay authoritative. Money never becomes a JS number (ADR-0006). Strings that aren't `-?d+(.dd?)?` count as zero.
 */
export function sumMoney(amounts: readonly string[]): string {
  let total = 0n;
  for (const a of amounts) {
    const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(a.trim());
    if (!m) continue;
    const paisa = BigInt(m[2] ?? '0') * 100n + BigInt((m[3] ?? '').padEnd(2, '0') || '0');
    total += m[1] ? -paisa : paisa;
  }
  const negative = total < 0n;
  const abs = negative ? -total : total;
  return `${negative ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/** What a MoneyInput accepts: up to 12 digits and 2 decimals, no sign or grouping. */
export const MONEY_INPUT = /^\d{1,12}(\.\d{1,2})?$/;

/** `"45000"` or `"45000.5"` → `"45000.00"` / `"45000.50"`, as the API expects. Input must match `MONEY_INPUT`. */
export function toDecimal(input: string): string {
  const [i = '0', f = ''] = input.trim().split('.');
  return `${i.replace(/^0+(?=\d)/, '')}.${f.padEnd(2, '0')}`;
}
