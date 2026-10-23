import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { themeEnum, userStatus } from './enums';
import { citext } from './types';

// DATA-MODEL.md §2. Core fields are Better Auth's; the rest are ours (declared as additionalFields in @hrm/auth).
export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    email: citext().notNull().unique(),
    emailVerified: boolean().notNull().default(false),
    name: text().notNull(),
    image: text(),
    status: userStatus().notNull().default('invited'),
    theme: themeEnum().notNull().default('ink'),
    locale: text().notNull().default('en'),
    twoFactorEnabled: boolean().notNull().default(false),
    lastLoginAt: timestamp({ withTimezone: true }),
    statusChangedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    createdBy: uuid(),
    updatedBy: uuid(),
    version: integer().notNull().default(1),
  },
  (t) => [
    check('users_locale', sql`${t.locale} IN ('en', 'bn')`),
    index('users_status_idx').on(t.companyId, t.status),
  ],
);
