import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyColumn, standardColumns, userRef } from './columns';
import { employees } from './employees';
import { settingScope } from './enums';
import { citext, inet } from './types';
import { users } from './users';

export const settings = pgTable(
  'settings',
  {
    companyId: companyColumn(),
    key: text().notNull(),
    scope: settingScope().notNull(),
    value: jsonb().notNull(),
    ...standardColumns(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.key] }),
    check('settings_key_fmt', sql`${t.key} ~ '^[a-z][a-z0-9_.]{2,99}$'`),
  ],
);

export const settingsHistory = pgTable(
  'settings_history',
  {
    id: uuid().primaryKey(),
    companyId: uuid().notNull(),
    key: text().notNull(),
    oldValue: jsonb(),
    newValue: jsonb().notNull(),
    changedBy: userRef(),
    changedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.companyId, t.key],
      foreignColumns: [settings.companyId, settings.key],
    }).onDelete('restrict'),
    index('settings_history_key_idx').on(t.companyId, t.key, t.changedAt.desc()),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    actorUserId: userRef(),
    actorType: text().notNull(),
    action: text().notNull(),
    category: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid(),
    employeeId: uuid().references(() => employees.id, { onDelete: 'restrict' }),
    requestId: text(),
    ipAddress: inet(),
    userAgent: text(),
    metadata: jsonb().notNull().default({}),
  },
  (t) => [
    check('audit_logs_actor_type', sql`${t.actorType} IN ('user', 'system')`),
    check('audit_logs_action_fmt', sql`${t.action} ~ '^[a-z_]+\\.[a-z_.]+$'`),
    check('audit_logs_category', sql`${t.category} IN ('business', 'payroll', 'security', 'technical')`),
    index('audit_logs_occurred_idx').on(t.companyId, t.occurredAt.desc()),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId, t.occurredAt.desc()),
    index('audit_logs_actor_idx').on(t.actorUserId, t.occurredAt.desc()),
    index('audit_logs_action_idx').on(t.companyId, t.action, t.occurredAt.desc()),
    index('audit_logs_employee_idx').on(t.employeeId, t.occurredAt.desc()),
  ],
);

export const outboxStatus = pgEnum('outbox_status', ['pending', 'processing', 'sent', 'failed', 'dead']);

export const outboxMessages = pgTable(
  'outbox_messages',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
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

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    idempotencyKey: text().notNull(),
    operation: text().notNull(),
    requestHash: text().notNull(),
    status: text().notNull(),
    responseStatus: integer(),
    responseBody: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    unique('idempotency_uq').on(t.userId, t.idempotencyKey, t.operation),
    check('idempotency_key_len', sql`length(${t.idempotencyKey}) BETWEEN 8 AND 100`),
    check('idempotency_status', sql`${t.status} IN ('in_progress', 'completed')`),
    index('idempotency_expiry_idx').on(t.expiresAt),
  ],
);

export const jobRuns = pgTable(
  'job_runs',
  {
    id: uuid().primaryKey(),
    companyId: companyColumn(),
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
