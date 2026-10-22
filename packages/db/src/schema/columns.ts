import { customType, integer, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Case-insensitive text (requires the citext extension). */
export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/**
 * Standard columns (DATA-MODEL.md conventions). The `created_by`/`updated_by` foreign keys to `users`
 * are added by the identity migration in Stage 8, once the users table exists.
 */
export const standardColumns = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid(),
  updatedBy: uuid(),
  version: integer().notNull().default(1),
};
