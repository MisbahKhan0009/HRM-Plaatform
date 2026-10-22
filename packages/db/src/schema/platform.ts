import { sql } from 'drizzle-orm';
import {
  char,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext, standardColumns } from './columns';

// DATA-MODEL.md §1. Platform. Tables that reference users/employees follow in Stage 8.

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
    ...standardColumns,
  },
  (t) => [
    check('companies_name_len', sql`length(${t.name}) BETWEEN 1 AND 200`),
    check('companies_currency_fmt', sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const outboxStatus = pgEnum('outbox_status', ['pending', 'processing', 'sent', 'failed', 'dead']);

export const outboxMessages = pgTable(
  'outbox_messages',
  {
    id: uuid().primaryKey(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    topic: text().notNull(),
    payload: jsonb().notNull(),
    dedupeKey: text(),
    status: outboxStatus().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp({ withTimezone: true }),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check('outbox_attempts_nonneg', sql`${t.attempts} >= 0`),
    uniqueIndex('outbox_dedupe_uq').on(t.companyId, t.dedupeKey).where(sql`${t.dedupeKey} IS NOT NULL`),
    index('outbox_due_idx').on(t.nextAttemptAt).where(sql`${t.status} IN ('pending', 'failed')`),
  ],
);

export const emailDeliveries = pgTable(
  'email_deliveries',
  {
    id: uuid().primaryKey(),
    outboxMessageId: uuid().references(() => outboxMessages.id, { onDelete: 'restrict' }),
    template: text().notNull(),
    toAddress: citext().notNull(),
    provider: text().notNull().default('gmail'),
    providerMessageId: text(),
    status: text().notNull(),
    error: text(),
    attemptedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('email_deliveries_status', sql`${t.status} IN ('sent', 'failed')`),
    index('email_deliveries_outbox_idx').on(t.outboxMessageId),
  ],
);

export const jobRuns = pgTable(
  'job_runs',
  {
    id: uuid().primaryKey(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    job: text().notNull(),
    runKey: text().notNull(),
    status: text().notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
    items: integer().notNull().default(0),
    details: jsonb().notNull().default({}),
    error: text(),
  },
  (t) => [
    check('job_runs_status', sql`${t.status} IN ('running', 'succeeded', 'failed')`),
    unique('job_runs_once_uq').on(t.companyId, t.job, t.runKey),
    index('job_runs_recent_idx').on(t.job, t.startedAt.desc()),
  ],
);
