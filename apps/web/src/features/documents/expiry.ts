/** Days added to a `YYYY-MM-DD` business date, as a `YYYY-MM-DD` string (display only, no time zone). */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** INFORMATION-ARCHITECTURE §5 widget 10: "expiring" means within the next 30 days. */
export const EXPIRY_WINDOW_DAYS = 30;

export type ExpiryState = 'expired' | 'expiring' | null;

export function expiryState(expiryDate: string | null, today: string): ExpiryState {
  if (!expiryDate) return null;
  if (expiryDate < today) return 'expired';
  if (expiryDate <= addDays(today, EXPIRY_WINDOW_DAYS)) return 'expiring';
  return null;
}
