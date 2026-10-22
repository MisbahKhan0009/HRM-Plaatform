# Observability

Status: **Accepted**, 2026-10-22. Covers logs, errors, health checks, job monitoring and alerts. Meets NFR-OPS-006 and SRS §10.5. Uses only free services: Workers Logs, Sentry Developer, GitHub notifications, email (D-032, ADR-0008).

## 1. Signals at a glance

| Signal | Where | Retention | Who looks |
|---|---|---|---|
| Request and job logs (structured JSON) | Cloudflare Workers Logs (dashboard → Workers → `hrm-<env>` → Logs) | Short on the free plan (verify in dashboard) | Developers, on demand |
| Live log stream | `wrangler tail hrm-prod --format pretty` | Live only | During incidents |
| Errors and exceptions (API and browser) | Sentry projects `hrm-api`, `hrm-web` | Per Sentry Developer plan | Owner gets email alerts |
| Worker metrics (requests, errors, CPU time, wall time) | Cloudflare dashboard → Workers → Metrics | Dashboard default | Weekly review |
| Business audit trail | Postgres `audit_logs` (in-app audit page) | Permanent | Authorised reviewers (FR-AUD-005) |
| Background jobs | Postgres `job_runs` + in-app health page (`system.health.read`) | 90 days | `system_admin` |
| Email delivery | Postgres `outbox_messages` / `email_deliveries` | 30 days after sent | `system_admin` |
| Backups | GitHub Actions run history for `nightly-backup.yml`; R2 object list | 30 days / 12 months | Owner |

Audit logs are business records and live in the database. Diagnostic logs are separate and short-lived (SRS §10.5). Never use diagnostic logs as the audit trail.

## 2. Structured logging

The API uses one logger (`apps/api/src/lib/logger.ts`) that writes one JSON object per line with `console.log`. Workers Logs indexes the fields.

Fields on every line:

| Field | Example | Notes |
|---|---|---|
| `ts` | `2026-11-02T04:12:09.120Z` | UTC |
| `level` | `info` / `warn` / `error` | |
| `msg` | `leave.request.approved` | Event name, `module.entity.action` |
| `requestId` | `01JC…` | From `cf-ray` if present, else generated; returned to the client as `X-Request-Id` and shown on error pages |
| `env`, `version` | `production`, `v1.4.0` | |
| `route`, `method`, `status`, `durationMs` | | Request summary line |
| `userId` | UUID | Never email, name or phone |
| `jobName`, `jobRunId` | | For cron work |

**Never log:** OTP codes, session tokens, cookies, `Authorization` headers, passkey or TOTP material, national ID numbers, phone numbers, addresses, salary or payment amounts, request bodies of auth, employee-contact or payroll routes, or file contents. A unit test feeds sample sensitive payloads through the logger's redaction and asserts they don't appear.

Log levels: `info` for request summaries and state transitions; `warn` for handled problems (validation spikes, retries); `error` for failures that need a human. Keep `info` volume low: one summary line per request, not one per query. Workers Logs on the free plan has a daily event cap (ADR-0009, verify the current number in the dashboard).

## 3. Health endpoint

`GET /api/v1/health`, public, no auth, no PII. Used by smoke checks (`DEPLOYMENT.md` §5) and by the external uptime check (§6).

```json
{ "status": "ok", "version": "v1.4.0", "db": "ok", "time": "2026-11-02T04:12:09Z" }
```

- `db` runs `SELECT 1` through Hyperdrive with a 3-second timeout. If it fails, `status` is `degraded` and the HTTP status is 503.
- Calling this endpoint wakes Neon from scale-to-zero, so **do not poll it more often than every 30 minutes**, and only during working hours (`ENVIRONMENTS.md` §4, Neon compute budget).

`GET /api/v1/health/details` (permission `system.health.read`) adds: last run and status of every job from `job_runs`, count of `dead` outbox messages, age of the newest backup (read from R2 `daily/` listing), and Neon database size.

## 4. Sentry

Setup for both projects (`ACCOUNT-SETUP.md` §6):

- API: `@sentry/cloudflare` wrapping the Worker `fetch` and `scheduled` handlers. Browser: `@sentry/react`.
- `sendDefaultPii: false`. `tracesSampleRate: 0` (performance tracing uses quota; Cloudflare metrics cover latency).
- `release` = git tag; `environment` = `staging`/`production`. Source maps uploaded by CI, never served (`CI-CD.md` §7).
- `beforeSend` scrubber removes: request bodies, cookies, `Authorization`, query strings on auth routes, and any key matching `/otp|token|secret|password|salary|gross|net|amount|nid|national|phone|address/i`. Keep only `userId` as user context.
- Sentry's server-side data scrubber and "Prevent storing of IP addresses" are on as a second layer.
- Ignore expected errors: 4xx responses aren't sent to Sentry, except 403 `FORBIDDEN` spikes, which are counted in logs (§6).

Quota: 5k errors a month on the Developer plan. If a single bug floods Sentry, use Sentry's per-issue rate limit or a `beforeSend` sample for that fingerprint, and fix the bug.

## 5. Job monitoring

Every job run (`ARCHITECTURE.md` §4) writes a `job_runs` row: `job_name`, `started_at`, `finished_at`, `status` (`succeeded`/`failed`), `items_processed`, `error_summary`. The dispatcher records a failed run even when the job throws. The health details page shows, per job, the last success and whether it's overdue (for example `leave.accrue` missing on the 1st).

## 6. Alerts

All alerts go by email to the operations mailbox and the owner. All channels are free.

| ID | Alert | Source | Condition | First response |
|---|---|---|---|---|
| AL-01 | API errors spike | Sentry `hrm-api` alert rule | > 10 events in 5 min, or any new issue in production | `INCIDENT-RUNBOOKS.md` IR-01 |
| AL-02 | Browser errors spike | Sentry `hrm-web` | > 20 events in 10 min | IR-01 |
| AL-03 | Backup failed | GitHub Actions failure email for `nightly-backup.yml` | Any failure | `BACKUP-AND-RESTORE.md` §3; re-run by hand |
| AL-04 | Backup stale | `nightly.yml` checks the newest `daily/` object | Older than 26 h | Same |
| AL-05 | Payroll job or action failed | Sentry, tagged `module:payroll` | Any error in calculate/lock/payments | IR-07; tell the payroll officer |
| AL-06 | Repeated auth failures | API counts failed OTP verifications per email/IP in a sliding window; on threshold it logs `warn auth.bruteforce_suspected` and sends a Sentry message | ≥ 20 failures from one IP in 15 min, or ≥ 10 for one account | IR-08 |
| AL-07 | Outbox dead letters | Dispatcher sends a Sentry message when a message becomes `dead` | Any | IR-04 |
| AL-08 | Job overdue | Daily dispatcher checks `job_runs` | A daily job hasn't succeeded in 26 h | IR-06 |
| AL-09 | Site unreachable | GitHub Actions scheduled check in `nightly.yml` (`curl /api/v1/health`), and a free external uptime monitor if the owner adds one (check interval ≥ 30 min, working hours only, §3) | Non-200 | IR-01 |
| AL-10 | CPU limit errors | Weekly review of Workers metrics (`exceededCpu` outcomes) | Any | IR-02 |

AL-10 and the free-tier checks are manual reviews, because Cloudflare's notification features on the free plan are limited. They are in the weekly and monthly checklists in `FREE-TIER-MONITORING.md`.
