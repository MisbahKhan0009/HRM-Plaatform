# System architecture

Status: **Accepted** — 2026-10-22. A modular monolith on Cloudflare Workers Free, with Postgres (Neon Free) as the system of record. Stack: `docs/01-tech-stack/TECH-STACK.md`. Structure: `MONOREPO.md`. Domain: `DOMAIN-MODEL.md`. Authorization: `SECURITY-MODEL.md`.

## 1. System context

```text
 Employees / Managers / HR / Payroll / Director / Auditor
        │  browser (desktop + mobile), HTTPS
        ▼
 ┌─────────────────────────────── Cloudflare ───────────────────────────────┐
 │  Worker  hrm.<account>.workers.dev                                        │
 │   ├─ Static assets: React SPA (apps/web/dist)  ← free, not counted        │
 │   ├─ /api/v1/*  Hono API (apps/api)                                       │
 │   └─ scheduled()  Cron Trigger every minute → job dispatcher              │
 │        bindings: HYPERDRIVE ─────────────┐   R2 (private bucket)          │
 └──────────────────────────────────────────┼───────────────────────────────┘
                                            ▼
                               Neon Postgres (Singapore, Free)
 External: Gmail API (email) · Sentry (errors) · GitHub Actions (CI/CD, nightly backups → R2)
```

## 2. Request lifecycle (API)

```text
request → request-id → secure headers → error handler
        → session (Better Auth cookie) → strong-auth check for privileged roles
        → rate limit (auth & sensitive routes)
        → route: zod-validate input (OpenAPI schema)
        → service: policy.check(permission, scope, record)
                   db.transaction { domain rule → repository writes → audit row → outbox row }
        → DTO mapping (per-permission) → JSON response
```

- **One DB transaction per command.** Audit and outbox rows are written in the same transaction as the business change, so a business change is never left without its audit or notification, and an email failure never undoes it (FR-WF-008).
- **Idempotency:** commands that create money or ledger effects (`calculate`, `lock`, `payments/import`, leave `approve`) accept an `Idempotency-Key` header and store the outcome in `idempotency_records` (FR-PAY-019).
- **Concurrency:** optimistic locking (`version` column, `If-Match`-style `version` in body) for edits; `SELECT … FOR UPDATE` for balance and payroll-run transitions.

## 3. Layers

| Layer | Location | Knows about | Must not |
|---|---|---|---|
| Route | `apps/api/src/modules/*/*.routes.ts` | HTTP, contracts | contain business rules or SQL |
| Service | `*.service.ts` | transactions, policies, domain, repositories | build HTTP responses |
| Policy | `*.policy.ts` | permissions, scopes | query outside its scope helper |
| Domain | `packages/domain` | pure rules, Decimal, dates | do I/O |
| Repository | `*.repository.ts`, `packages/db` | Drizzle, SQL | contain business rules |
| UI | `apps/web` | contracts, ui | contain authoritative rules |

## 4. Background work (ADR-0002, D-036)

A single Cron Trigger (`* * * * *`) runs `scheduled()`, which dispatches:

| Job | Frequency | What |
|---|---|---|
| `outbox.process` | every minute | Sends up to N pending messages (emails); retries with exponential backoff; marks `dead` after 8 failures and alerts |
| `employee.apply_effective_events` | daily 00:05 Asia/Dhaka | Applies effective-dated status/position/manager changes |
| `attendance.close_day` | daily 00:15 | Finalises yesterday's attendance records (absent, missing punch) |
| `leave.accrue` | monthly, 1st 01:00 | Posts accrual entries per policy |
| `leave.year_end` | 1 Jan 01:30 | Carry-forward and expiry entries |
| `documents.expiry_reminders` | daily 09:00 | Emails HR about documents and contracts that are expiring |
| `maintenance.prune` | daily 03:00 | Prunes old sessions, sent outbox rows, expired idempotency records |

Every job is idempotent (safe to re-run) and keeps its CPU low by doing set-based SQL, within the 10 ms free CPU limit (ADR-0009). Jobs record runs in `job_runs` for the health page (FR-SET-004).

## 5. Files

Upload: client → `POST /api/v1/documents` (multipart, ≤ 10 MB, type allow-list, magic-byte sniffing) → Worker streams to R2 key `documents/{employeeId}/{documentId}/v{n}` → DB row with SHA-256 checksum. Download: `GET /api/v1/documents/{id}/download` → permission check → stream from R2 with `Content-Disposition: attachment`. There are no public bucket URLs (FR-DOC-008).

## 6. Payslips and exports (D-037)

The API returns the immutable payroll snapshot (`GET /payroll/payslips/{id}`). The browser renders the PDF with `packages/documents`. Reports return paginated JSON; the browser builds CSV/XLSX. Server-side permission checks are identical for view and export (FR-REP-006).

## 7. Cross-cutting concerns

| Concern | Approach | Doc |
|---|---|---|
| Errors | RFC 9457 `application/problem+json` with stable `code` | `05-backend/API-STANDARDS.md` |
| Logging | Structured JSON to Workers Logs; request id on every line; no PII | `08-operations/OBSERVABILITY.md` |
| Audit | `audit_logs` append-only (DB grants deny UPDATE/DELETE to app role) | `05-backend/AUDIT.md` |
| Time | UTC in DB; business dates in `Asia/Dhaka` | `05-backend/BUSINESS-RULES.md` |
| Money | `NUMERIC(14,2)`, Decimal in code, strings on the wire | ADR-0006 |
| i18n | Message keys on the frontend; API error `code` (not text) drives UI messages | `06-frontend/I18N.md` |
| Config | `settings` table (business) + Wrangler vars/secrets (technical) | `08-operations/ENVIRONMENTS.md` |

## 8. Quality attributes and how they're met

| Attribute | Target | Mechanism |
|---|---|---|
| Security | SRS §9.1 | Server-side policies, IDOR tests, passwordless auth, private R2, audit |
| Performance | p95 < 500 ms (warm) | Edge Worker, Hyperdrive pooling, indexed queries, pagination; Neon cold start ~1 s accepted |
| Availability | 99.5% target (no SLA on free tiers) | Stateless Worker; Neon; health checks; Sentry alerts |
| Recoverability | RPO ≤ 24 h, RTO ≤ 4 h | Nightly encrypted `pg_dump` to R2 + Neon 6 h restore window; quarterly restore drill |
| Maintainability | NFR-MNT | Modular monolith, enforced boundaries, generated OpenAPI, tests in CI |
| Cost | $0 | ADR-0009 guardrails |
