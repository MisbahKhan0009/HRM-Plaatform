# Background jobs and the outbox

Status: **Accepted**, 2026-10-22. Normative. Implements ADR-0002 and D-036 as revised in `docs/03-architecture/ARCHITECTURE.md` section 4. Tables: `outbox_messages`, `email_deliveries`, `job_runs` in `docs/03-architecture/DATA-MODEL.md` section 1.

The design has two constraints. Neon Free gives 100 compute-hours per month and must be able to scale to zero, so nothing may query the database every minute. Workers Free gives 10 ms CPU per invocation and at most 5 cron triggers per account. The result is: emails are sent right after the request that caused them, a retry cron runs only during working hours, and one daily dispatcher runs all scheduled work.

## 1. Triggers

| Trigger | Cron (UTC) | Asia/Dhaka | Environments | Runs |
|---|---|---|---|---|
| Retry | `*/15 2-14 * * SUN-THU` | every 15 min, 08:00 to 20:59, Sun to Thu | production | `outbox.retry` |
| Daily | `5 18 * * *` | 00:05 every day | production, staging | daily dispatcher (section 3) |

Two triggers in production plus one in staging leaves two of the five free triggers unused. Cron expressions are in `apps/api/wrangler.jsonc` per environment.

```ts
// apps/api/src/index.ts
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const jobs = createJobs(env, ctx);
    if (event.cron === '*/15 2-14 * * SUN-THU') return jobs.outboxRetry();
    if (event.cron === '5 18 * * *') return jobs.dailyDispatcher(new Date(event.scheduledTime));
  },
};
```

## 2. Outbox

### 2.1 Writing

A service that needs a side effect (an email today; other channels later) calls `outbox.enqueue(tx, { topic, payload, dedupeKey })` inside its business transaction. The row commits or rolls back with the business change, so an email is never sent for a change that did not happen, and a failed email never undoes a committed change (FR-WF-008).

- `topic` names the template: `email.<template>` (EMAIL.md section 3).
- `payload` holds ids and display values only; the processor re-reads anything sensitive at send time and checks the recipient is still `active`.
- `dedupeKey` prevents duplicates when a command is retried, for example `leave_request.approved:<requestId>`.

### 2.2 Immediate send after commit

The service returns the new outbox ids. The route handler, after the transaction commits, calls:

```ts
c.executionCtx.waitUntil(processOutbox(env, ids));
```

`waitUntil` lets the response return at once while the Worker finishes sending. Most emails leave within seconds, and no cron is needed for the normal case.

### 2.3 Processing one message

```text
claim:   UPDATE outbox_messages SET status='processing', locked_until=now()+interval '2 min', attempts=attempts+1
         WHERE id = ANY($ids) AND status IN ('pending','failed') AND (locked_until IS NULL OR locked_until < now())
         RETURNING *
send:    render template, call the Mailer (outside any transaction)
success: status='sent', processed_at=now(); insert email_deliveries(status='sent', provider_message_id)
failure: insert email_deliveries(status='failed', error);
         attempts < 8  -> status='failed', next_attempt_at = now() + backoff(attempts)
         attempts >= 8 -> status='dead'; audit outbox.message_dead; Sentry alert
```

`backoff(n)` = 1, 5, 15, 30, 60, 120, 240 minutes for attempts 1 to 7. The `locked_until` claim makes concurrent processing (an after-commit send racing the retry cron) safe: only one claimant gets each row.

### 2.4 Retry cron

`outbox.retry` runs one query and stops when it returns nothing:

```sql
SELECT id FROM outbox_messages
WHERE status IN ('pending', 'failed') AND next_attempt_at <= now()
ORDER BY next_attempt_at LIMIT 20;
```

The partial index `outbox_due_idx` covers it. It then processes the ids as in 2.3. A run touches the database for a few milliseconds every 15 minutes during working hours (about 52 runs per working day), which leaves Neon idle at night and at weekends.

Messages created outside retry hours wait until the next working-hours run if the immediate send failed. Sign-in codes are not affected, because they are sent inline (EMAIL.md section 4).

## 3. Daily dispatcher

Runs at 00:05 Asia/Dhaka. Steps run in this order; a failing step is recorded and the dispatcher continues with the next step, except where a later step depends on it (noted).

| Step | Runs on | Purpose | `run_key` |
|---|---|---|---|
| `employee.apply_effective_events` | every day | Apply `employment_events` with `status = scheduled` and `effective_date <= today`: update the employee row, set the event `applied` | date |
| `attendance.close_day` | every day | Finalise yesterday's records (BUSINESS-RULES 2.4) | date |
| `leave.year_end` | 1 January | Expiry and carry-forward for the previous year, then annual grants (BUSINESS-RULES 5.4). Depends on `attendance.close_day` | year |
| `leave.accrue` | 1st of each month | Monthly and per-days-worked accrual for the previous month (BUSINESS-RULES 5.2, 5.3). Depends on `attendance.close_day` | `YYYY-MM` |
| `leave.carry_forward_expiry` | every day, only if a policy has `carry_forward_expiry_months` and today is its expiry date | Expire unused carried-forward days | date |
| `leave.eligibility_grants` | every day | Prorated first grants for employees who became eligible yesterday (BUSINESS-RULES 5.1) | date |
| `documents.expiry_reminders` | every day | Enqueue one digest email to HR listing documents and contracts expiring in 30, 14, 7 and 0 days (FR-DOC-006) | date |
| `accounts.apply_access_revocation` | every day | Deactivate users of employees whose `separation_date` was yesterday and revoke their sessions | date |
| `maintenance.prune` | every day | Retention deletes (DATABASE-CONVENTIONS section 8), leave balance consistency check, audit counts | date |

The dispatcher sends any outbox messages its steps enqueued with `ctx.waitUntil`, as in 2.2.

### 3.1 Avoiding empty queries

- Date checks (`is today 1 January?`, `is today the 1st?`) are done in code before any query.
- `leave.carry_forward_expiry` reads the small `leave_policies` table once and skips the step when no policy expires today.
- Every step's first query is a cheap existence check on an indexed column (for example `employment_events_due_idx`), and the step returns as soon as it finds nothing.

## 4. Job runs and idempotency

Every step is wrapped in `runJob(name, runKey, fn)`:

```text
INSERT INTO job_runs (id, company_id, job, run_key, status) VALUES (..., 'running')
  ON CONFLICT (company_id, job, run_key) DO NOTHING RETURNING id
no row returned and existing status = 'succeeded'  -> skip (already done)
no row returned and existing status = 'failed'     -> set 'running' and retry
run fn(tx); set status='succeeded', finished_at, items, details
on error: set status='failed', error (message only); audit job.failed; Sentry alert
```

Each step is idempotent on its own as well: ledger postings use the unique index `leave_ledger_accrual_once_uq`, effective events change status exactly once, and attendance close recomputes deterministically. Re-running the dispatcher for the same day is therefore safe.

A missed day (Cloudflare outage, Neon suspended) is recovered by an admin calling `POST /admin/jobs/{job}/run` with a `runKey` (permission `system.health.read` plus `settings.technical.manage`, strong session). Steps that work "for yesterday" accept an explicit date.

## 5. CPU budget (ADR-0009)

Each scheduled invocation also has 10 ms of CPU on Workers Free; time waiting for Postgres or Gmail does not count.

- Work is done in set-based SQL: one `INSERT ... SELECT` posts accrual for all employees; attendance close is one `INSERT ... ON CONFLICT DO UPDATE` built from a query over `attendance_events`, with the status logic written once in SQL and mirrored by the TypeScript domain function used for single-day recomputation. A test asserts both give the same result on fixtures.
- Steps never load all rows into JavaScript to transform them.
- The outbox processes at most 20 messages per invocation; template rendering is string interpolation, not a heavy templating library.
- If a step's CPU grows near the limit (visible in Workers Logs `cpuTime`), split it across days or move the logic into SQL before adding features.

## 6. Monitoring

- `GET /health/details` shows the last run of each job, the count of `pending`/`failed`/`dead` outbox rows and the oldest pending age (FR-SET-004).
- Sentry alerts: any `job.failed`, any `dead` outbox message, and the daily dispatcher not having succeeded by 01:00 (a check performed by the retry cron's first run of the day on working days, and by the next dispatcher otherwise).
- Operator procedures: `docs/08-operations/INCIDENT-RUNBOOKS.md`.
