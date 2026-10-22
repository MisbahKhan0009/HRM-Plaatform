# Free-tier monitoring

Status: **Accepted**, 2026-10-22. The HRM runs at $0 (D-032). Every service has a limit, and some fail hard when it's reached. This checklist catches limits early. Limits come from ADR-0009; providers change them, so confirm the current numbers in each dashboard at the first monthly check and update the table.

## 1. Limits and thresholds

| Service | Limit (per ADR-0009) | What happens at the limit | Warn at | Where to check |
|---|---|---|---|---|
| Workers requests | 100k/day (static assets excluded) | Requests fail until 00:00 UTC | 50k/day | Dashboard → Workers → `hrm` → Metrics |
| Workers CPU | 10 ms per request | That request fails (error 1102) | Any `exceededCpu` | Metrics → CPU time; `wrangler tail` |
| Worker size | 3 MB compressed | Deploy fails | 2 MB (CI enforces, PB-03) | CI budget job |
| Cron Triggers | Limited per account (verify) | Can't add more | — | Workers → Settings |
| Hyperdrive | Free daily query allowance (verify) | Queries fail | 50% of allowance | Dashboard → Hyperdrive → `hrm-prod-db` |
| Workers Logs | Daily event cap (verify) | Logs dropped | 50% | Workers → Logs |
| Neon storage | 0.5 GB per project | Writes fail | 350 MB (PB-13) | Neon console → Project → Usage; or SQL `pg_database_size` |
| Neon compute | 100 CU-hours per project per month | **Compute suspended until next month: app down** | 50 CU-h before the 20th | Neon console → Usage |
| Neon transfer | 5 GB public transfer per month | Suspended (verify) | 2.5 GB | Neon console → Usage |
| Neon branches | 10 per project | Can't create | 6 | Branches page |
| R2 storage | 10 GB-month | **Charged** to the card on file | 6 GB | Dashboard → R2 → Overview |
| R2 Class A ops (writes) | 1M/month | **Charged** | 500k | R2 → Metrics |
| R2 Class B ops (reads) | 10M/month | **Charged** | 5M | R2 → Metrics |
| Gmail API sending | ~500 emails/day | Sending blocked for up to 24 h | 250/day | `email_deliveries` count per day (health details) |
| Sentry | 5k errors/month, 1 seat | Events dropped | 3k | Sentry → Stats |
| GitHub Actions (private repo) | 2,000 min/month | Workflows stop until next month | 1,600 | GitHub → Settings → Billing → Usage |

**Neon compute is the biggest risk.** An always-awake database uses ≈ 180 CU-hours a month, above the 100 allowance. Anything that queries the database on a timer (cron every minute, uptime checks every few minutes) keeps it awake. See `ENVIRONMENTS.md` §4 for the schedule rules that keep usage down.

## 2. Weekly check (5 minutes, every Sunday)

1. Workers → `hrm` → Metrics: errors, CPU time p99 (< 8 ms), any `exceededCpu`.
2. Neon → Usage: compute hours used this month. Projected = used ÷ days elapsed × days in month. If projected > 80, see §4.
3. Sentry → Issues: anything new or unresolved.
4. Health details page: jobs overdue, dead outbox messages, newest backup < 26 h.

## 3. Monthly check (15 minutes, first working day)

1. Every row in §1: write the value in the log below.
2. R2 storage and operations: confirm well inside the free allowance. Anything above it is billed to the card.
3. Neon storage: `SELECT pg_size_pretty(pg_database_size(current_database()));`
4. GitHub Actions minutes for last month.
5. Size of last night's backup (`aws s3 ls s3://hrm-backups/daily/ --endpoint-url …`). Over 150 MB → `BACKUP-AND-RESTORE.md` §3 note.
6. Confirm the restore-drill schedule (§5 of BACKUP-AND-RESTORE) is on track.

## 4. When a threshold is crossed

| Resource | Action, cheapest first |
|---|---|
| Neon compute | Find what keeps the DB awake (cron frequency, uptime monitor, a client polling). Reduce timers. Pause staging when not in use (staging compute counts towards the same project allowance). |
| Neon storage | Prune: sent outbox rows > 30 days, expired sessions, idempotency records > 7 days, `job_runs` > 90 days (`maintenance.prune`). Never prune audit logs or business records. |
| Workers requests | Check for a client loop or a crawler; check that static assets are served without invoking the Worker (`run_worker_first` limited to `/api/*`). |
| CPU | `PERFORMANCE-BUDGETS.md` §2; profile the route. |
| R2 | Find large uploads; enforce the 10 MB cap; compress images client-side. |
| Gmail | Move reminders to a daily digest; check for a retry loop. |
| Actions minutes | `CI-CD.md` §3. |

## 5. Upgrade path (owner decision, each step costs money)

If the company outgrows the free tiers, upgrade in this order. Each step is independent:

1. **Workers Paid** ($5/month as of ADR-0009): CPU up to 30 s by default, more requests, Queues, Cloudflare Email Service.
2. **Custom domain** + transactional email provider: removes the Gmail dependency; passkeys must be re-registered (ADR-0004).
3. **Neon paid plan**: more compute hours, longer restore window.

Record any upgrade as a new decision in `docs/00-requirements/DECISION-LOG.md`, since it reverses D-032.

## 6. Monthly log

| Month | Workers peak req/day | CPU p99 | Neon CU-h | Neon storage | R2 GB | Emails peak/day | Sentry events | Actions min | Checked by |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |
