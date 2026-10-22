import { customType } from 'drizzle-orm/pg-core';

/** Case-insensitive text (requires the citext extension). */
export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/** Postgres inet (IP evidence only, D-009). */
export const inet = customType<{ data: string }>({ dataType: () => 'inet' });
