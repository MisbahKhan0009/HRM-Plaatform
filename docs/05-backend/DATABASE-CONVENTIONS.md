# Database conventions

Status: **Accepted**, 2026-10-22. Normative for `packages/db` and all repositories. Table definitions are in `docs/03-architecture/DATA-MODEL.md`; platform choice in ADR-0003.

## 1. Naming

| Object | Rule | Example |
|---|---|---|
| Table | snake_case, plural | `leave_requests` |
| Column | snake_case, singular | `employee_id`, `work_date` |
| Primary key | `id uuid` (UUID v7 from the app) | |
| Foreign key column | `<referenced singular>_id` | `leave_type_id` |
| Boolean | `is_`, `has_`, `allows_`, `requires_` prefix | `is_active` |
| Timestamp | `_at` suffix, `timestamptz` | `decided_at` |
| Date | `_date` suffix or a domain name, `date` | `start_date`, `work_date` |
| Money | `_amount` suffix, `numeric(14,2)` | `gross_amount` |
| Index | `<table>_<purpose>_idx`; unique `_uq` | `leave_requests_status_idx` |
| Check constraint | Postgres default name or `<table>_<rule>_chk` | |
| Enum type | the `DOMAIN-MODEL.md` enum name | `employee_status` |

Drizzle schema files live in `packages/db/src/schema/<module>.ts`, one file per module, with camelCase properties and `casing: 'snake_case'` in the Drizzle config.

## 2. Roles and connections

- `hrm_owner`: owns the schema, runs migrations (used by CI and the migration script only).
- `hrm_app`: used by the Worker through Hyperdrive. `SELECT, INSERT, UPDATE` on business tables, no `DELETE` except on `sessions`, `verifications`, `rate_limits`, `idempotency_records`, `outbox_messages`, `email_deliveries` (pruning), and draft-only rows where the API allows delete. Append-only tables get `SELECT, INSERT` only (DATA-MODEL immutability summary).
- `hrm_readonly`: for ad-hoc support queries and the backup job.
- Each environment has its own Neon branch and its own role passwords.

## 3. Migrations

1. Change the Drizzle schema in `packages/db/src/schema`.
2. Run `pnpm --filter @hrm/db db:generate --name <short_description>`. drizzle-kit writes SQL to `packages/db/migrations/NNNN_<name>.sql`.
3. Read the generated SQL. Hand-edit it when needed (data backfills, triggers, grants, `CREATE EXTENSION`, `EXCLUDE` constraints, partial indexes drizzle-kit cannot express), and keep the snapshot in sync by regenerating if you changed the schema again.
4. Run `pnpm --filter @hrm/db db:migrate` against local Postgres, then run the test suite.
5. Commit schema, SQL and snapshot together. The PR shows the SQL for review.

Rules:

- **Forward-only.** No down migrations. A bad migration is fixed by a new migration.
- **Never edit an applied migration** (any migration merged to `main`).
- **Expand and contract** for breaking changes: (1) add the new column/table, (2) deploy code that writes both and reads the new, (3) backfill, (4) deploy code that only uses the new, (5) drop the old in a later migration. Each step is a separate deploy, so a rollback of the Worker never meets an incompatible schema.
- Migrations must be safe on a live database: create indexes `CONCURRENTLY` in their own migration file (drizzle-kit wraps migrations in a transaction, so mark those files to run without one); add `NOT NULL` columns with a default or in two steps.
- CI checks: `db:generate` produces no diff (schema and migrations agree); migrations apply cleanly to an empty database and to a copy of the previous release's schema.
- Deploy order: migrations run in the deploy job **before** `wrangler deploy` (`docs/08-operations/DEPLOYMENT.md`).

## 4. Seed data

`packages/db/seed/` holds idempotent seed scripts (`INSERT ... ON CONFLICT DO NOTHING`):

| Seed | Environments | Contents |
|---|---|---|
| `base` | all | company row, permissions, roles + role_permissions (SECURITY-MODEL section 4), settings with seed defaults (BUSINESS-RULES section 9), `code_sequences`, default work schedule (Sun to Thu), leave types and policies (seed defaults, BUSINESS-RULES section 5) |
| `holidays-<year>` | all | Bangladesh public holidays for the year, entered by HR from the official gazette and reviewed (dates of religious holidays depend on moon sighting and are confirmed each year) |
| `demo` | local, staging | 30 synthetic employees, departments, a manager tree, 3 months of attendance, leave requests, two payroll runs. Uses obviously fake names and `example.com` emails |

Production gets `base` and the current holiday seed only. Real employee data arrives through the import flow (FR-EMP-008), never through seed files.

## 5. Transactions and locking

- One transaction per command, opened by the service: `await db.transaction(async (tx) => { ... })`.
- Inside a transaction, write in this order: business rows, then `audit_logs`, then `outbox_messages`. All commit together (ARCHITECTURE section 2).
- **Optimistic locking** for user edits: `UPDATE ... SET ..., version = version + 1 WHERE id = $1 AND version = $2`. Zero rows means `409 VERSION_CONFLICT`.
- **Pessimistic locking** for counters and balances: `SELECT ... FOR UPDATE` on `leave_balances`, `code_sequences`, and the `payroll_runs` row before a transition. Lock in a fixed order (balance row, then request row) to avoid deadlocks.
- Keep transactions short: no external calls (email, R2, Gmail) inside a transaction. R2 uploads happen before the transaction; a failed transaction deletes the uploaded object.
- Isolation level: `READ COMMITTED` (Postgres default) plus explicit locks. Payroll `calculate` uses `REPEATABLE READ` so it sees one consistent snapshot of salary structures, claims and adjustments.
- Serialization failures (`40001`) and deadlocks (`40P01`) are retried up to 3 times by `withRetry()` around the transaction.

## 6. Scoping queries

All organization-scoped reads and writes go through helpers in `packages/db/src/scope.ts`:

```ts
export interface RequestScope {
  companyId: string;
  // employee ids the caller may see for the current permission, or 'all'
  employees: 'all' | readonly string[];
}

export const whereEmployeeInScope = (column: AnyPgColumn, scope: RequestScope) =>
  scope.employees === 'all' ? undefined : inArray(column, [...scope.employees]);
```

- The policy builds `RequestScope` from the permission that granted access (`own` = the caller's employee id, `team` = recursive reports, `all`), per BUSINESS-RULES section 7.2.
- Repositories always add `eq(table.companyId, scope.companyId)` and `whereEmployeeInScope(...)` before user filters.
- Fetch-by-id for a resource outside the scope returns no row, and the service returns `404 NOT_FOUND` (SECURITY-MODEL section 1, rule 6).

## 7. Hyperdrive and Neon

- Create the Drizzle client per request: `drizzle(postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false, prepare: true }))`. Hyperdrive pools connections at the edge; the Worker must not hold connections across requests.
- Hyperdrive query caching is **disabled** for this database (`caching: { disabled: true }` in the Hyperdrive config), because stale reads of balances and statuses are not acceptable.
- Neon Free scales compute to zero after 5 minutes idle. The first query after idle takes about 0.5 to 1 s; the UI shows normal loading states.
- Local development uses Postgres 16 in Docker with `wrangler dev --local` and a `localConnectionString` for the Hyperdrive binding.
- Never use `LISTEN/NOTIFY`, advisory locks held across requests, or session-level settings; Hyperdrive runs in transaction pooling mode.

## 8. Retention and pruning

`maintenance.prune` (JOBS-AND-OUTBOX) deletes:

| Table | Keep |
|---|---|
| `sessions` | until `expires_at` + 1 day |
| `verifications` | until `expires_at` |
| `rate_limits` | 1 day since last request |
| `idempotency_records` | until `expires_at` (24 h) |
| `outbox_messages` with `status = sent`, and their `email_deliveries` | 90 days |
| `outbox_messages` with `status = dead` | 1 year (then reviewed by an admin) |

Business tables and `audit_logs` are not pruned in v1. Personal-data retention after separation follows the owner's retention policy (NFR-SEC-010), still open.

## 9. Storage budget

Neon Free allows 0.5 GB per project (ADR-0009). The estimate in DATA-MODEL section 12 is about 200 MB after 5 years. `docs/08-operations/FREE-TIER-MONITORING.md` defines the monthly size check (`SELECT pg_database_size(current_database())`) and the action at 70% of the limit.
