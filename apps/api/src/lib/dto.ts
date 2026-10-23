/** ISO timestamp for the wire (API-STANDARDS §3). */
export const iso = (d: Date) => d.toISOString();
export const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

/** Keeps only the keys present in `input` (PATCH semantics: absent means unchanged). */
export function defined<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Standard audit fields of a mutable row. */
export const stamp = (row: { version: number; createdAt: Date; updatedAt: Date }) => ({
  version: row.version,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
