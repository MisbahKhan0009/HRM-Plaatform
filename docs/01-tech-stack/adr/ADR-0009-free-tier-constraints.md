# ADR-0009: Zero-cost operation and free-tier guardrails

- Status: Accepted (2026-10-22) — D-032

## Decision
The system must run at **$0/month**. Every developer must design within these limits:

| Service | Free limit | Our guardrail |
|---|---|---|
| Workers | 10 ms CPU/request, 100k requests/day, 3 MB compressed Worker | No password hashing; no PDF/XLSX in Worker; aggregation in SQL; keep bundle < 2 MB (CI check); static assets don't count toward requests |
| Cron Triggers | limited per account | One per-minute trigger dispatching all jobs |
| Hyperdrive | included in Free (limited) | Use for all DB access |
| Neon | 0.5 GB, 100 CU-h/month; compute suspended if exceeded | Files never in DB; audit/outbox pruning policy; monthly usage check |
| R2 | 10 GB, 1M Class A / 10M Class B ops per month | 10 MB upload limit; images compressed client-side; backups rotated (keep 30 daily + 12 monthly) |
| Gmail API | ~500 emails/day | Batch digests for reminders |
| Sentry | 5k errors/month, 1 seat | Sample non-critical errors; alerts to owner |
| GitHub Actions | 2,000 min/month (private) | Turborepo caching; run only affected tasks; Postgres service container instead of Neon branches |

Performance-heavy features must state their CPU strategy in their design doc. A CI check fails the build if the Worker bundle exceeds the budget.

## Consequences
+ No running cost.
− No SLA from free tiers; NFR-OPS-001 (99.5%) is a target, not a guarantee.
− If the company outgrows limits, the documented upgrade path is: Workers Paid ($5) → custom domain + Resend → Neon Launch.
