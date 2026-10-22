import { customType } from 'drizzle-orm/pg-core';

/** Case-insensitive text (requires the citext extension). */
export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/** Postgres inet (IP evidence only, D-009). */
export const inet = customType<{ data: string }>({ dataType: () => 'inet' });

/**
 * jsonb for values that may be bare JSON scalars (settings). postgres-js already parses jsonb, and Drizzle's jsonb
 * column parses again when the result is a string, turning the money string "5000.00" into the number 5000. This
 * type serialises once on write and keeps the driver's parsed value on read.
 */
export const jsonScalar = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => 'jsonb',
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => value,
});
