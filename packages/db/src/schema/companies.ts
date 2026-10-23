import { sql } from 'drizzle-orm';
import { char, check, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { citext } from './types';

// DATA-MODEL.md §1. companies is created before any user exists, so its created_by/updated_by have no FK.
export const companies = pgTable(
  'companies',
  {
    id: uuid().primaryKey(),
    name: text().notNull(),
    legalName: text(),
    logoDocumentId: uuid(),
    email: citext(),
    phone: text(),
    address: text(),
    timezone: text().notNull().default('Asia/Dhaka'),
    currency: char({ length: 3 }).notNull().default('BDT'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    version: integer().notNull().default(1),
  },
  (t) => [
    check('companies_name_len', sql`length(${t.name}) BETWEEN 1 AND 200`),
    check('companies_currency_fmt', sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);
