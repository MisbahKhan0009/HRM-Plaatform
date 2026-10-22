import { integer, timestamp, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { users } from './users';

/** Standard columns (DATA-MODEL.md conventions). A NULL actor means a system job. */
export const standardColumns = () => ({
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid().references(() => users.id, { onDelete: 'restrict' }),
  updatedBy: uuid().references(() => users.id, { onDelete: 'restrict' }),
  version: integer().notNull().default(1),
});

/** Company column (D-001): every organization-scoped table has it. */
export const companyColumn = () =>
  uuid()
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' });

/** A nullable user reference (decided_by, approved_by, …). */
export const userRef = () => uuid().references(() => users.id, { onDelete: 'restrict' });

export const tsz = () => timestamp({ withTimezone: true });
