# Environments

Status: **Accepted**, 2026-10-22. Describes the four environments, what each runs on, and how configuration differs. How to create the accounts: `ACCOUNT-SETUP.md`. Secret values: `SECRETS.md`. Deploying: `DEPLOYMENT.md`. Everything runs on free tiers (D-032, ADR-0009).

## 1. Overview

| | local | CI | staging | production |
|---|---|---|---|---|
| Purpose | Development | Automated checks on every PR | Integration, UAT, release candidate | Real use |
| Worker | `wrangler dev` (workerd on the laptop) | `vitest-plugin` (workerd in the runner) | `hrm-staging` | `hrm-prod` |
| URL | `http://localhost:8787` | — | `https://hrm-staging.<account-subdomain>.workers.dev` | `https://hrm-prod.<account-subdomain>.workers.dev` |
| Database | Postgres in Docker (`docker compose up db`) | Postgres service container | Neon branch `staging` | Neon branch `main` |
| DB access from Worker | `localConnectionString` for Hyperdrive | direct | Hyperdrive config `hrm-staging-db` | Hyperdrive config `hrm-prod-db` |
| Files | Miniflare local R2 (on disk) | Miniflare in-memory R2 | R2 bucket `hrm-staging-files` | R2 bucket `hrm-prod-files` |
| Email | In-memory/console mailer (prints the OTP in the terminal) | In-memory mailer | Gmail API, recipients limited to an allow-list | Gmail API |
| Cron | Trigger by hand: `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"` (needs `wrangler dev --test-scheduled`) | Called directly in tests | Enabled | Enabled |
| Sentry | Off | Off | Project `hrm`, environment `staging` | Project `hrm`, environment `production` |
| Data | Synthetic seed | Synthetic factories | Synthetic seed, or anonymised copy (NFR-SEC-009) | Real |
| Who has access | Developer | GitHub Actions | Developers, HR testers | Users; operators via dashboards |

The production Worker name `hrm-prod` gives the URL `hrm-prod.<account-subdomain>.workers.dev`. If the owner prefers `hrm.<account-subdomain>.workers.dev`, set `name: "hrm"` for the production environment **before** the first production deploy. Changing it later changes the URL, which breaks every registered passkey (ADR-0004).

## 2. Wrangler configuration layout

One file, `apps/api/wrangler.jsonc`. Top-level values are for local development; `env.staging` and `env.production` override them. Bindings are **not** inherited by environments in Wrangler, so each environment repeats them.

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "hrm-dev",
  "main": "src/index.ts",
  "compatibility_date": "<pin a date when scaffolding; update deliberately>",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "../web/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "observability": { "enabled": true },
  "vars": { "APP_ENV": "local", "APP_ORIGIN": "http://localhost:8787", "MAIL_MODE": "console" },
  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<local-placeholder>", "localConnectionString": "postgres://hrm:hrm@localhost:5432/hrm" }],
  "r2_buckets": [{ "binding": "FILES", "bucket_name": "hrm-dev-files" }],
  "triggers": { "crons": [] },

  "env": {
    "staging": {
      "name": "hrm-staging",
      "vars": { "APP_ENV": "staging", "APP_ORIGIN": "https://hrm-staging.<account-subdomain>.workers.dev", "MAIL_MODE": "gmail-allowlist" },
      "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<hyperdrive id of hrm-staging-db>" }],
      "r2_buckets": [{ "binding": "FILES", "bucket_name": "hrm-staging-files" }],
      "triggers": { "crons": ["<see section 4>"] }
    },
    "production": {
      "name": "hrm-prod",
      "vars": { "APP_ENV": "production", "APP_ORIGIN": "https://hrm-prod.<account-subdomain>.workers.dev", "MAIL_MODE": "gmail" },
      "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<hyperdrive id of hrm-prod-db>" }],
      "r2_buckets": [{ "binding": "FILES", "bucket_name": "hrm-prod-files" }],
      "triggers": { "crons": ["<see section 4>"] }
    }
  }
}
```

Placeholders in `<…>` are filled in once, during `ACCOUNT-SETUP.md`. Hyperdrive and R2 IDs are not secrets and are committed. Secrets are never in this file (`SECRETS.md`).

## 3. Configuration matrix

| Variable | Kind | local | staging | production |
|---|---|---|---|---|
| `APP_ENV` | var | `local` | `staging` | `production` |
| `APP_ORIGIN` | var | `http://localhost:8787` | staging URL | production URL |
| `MAIL_MODE` | var | `console` | `gmail-allowlist` | `gmail` |
| `MAIL_ALLOWLIST` | var | — | comma-separated test addresses | — |
| `MAIL_FROM` | var | — | `Big-Matrix HRM <hrm.bigmatrix@gmail.com>` (example) | same |
| `SENTRY_ENVIRONMENT` | var | — | `staging` | `production` |
| `BETTER_AUTH_SECRET` | secret | `.dev.vars` | `wrangler secret put … --env staging` | `… --env production` |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | secret | not needed | yes | yes |
| `SENTRY_DSN` | secret (low sensitivity) | — | yes | yes |
| `HYPERDRIVE` | binding | local connection string | Hyperdrive config | Hyperdrive config |
| `FILES` | binding | local R2 | `hrm-staging-files` | `hrm-prod-files` |

Business settings (company name, schedules, leave policies) live in the database `settings` tables, not in Wrangler.

## 4. Cron schedule and Neon compute

**A database query every minute would stop Neon from ever scaling to zero**, so there is no per-minute cron (adopted 2026-10-22, see `docs/03-architecture/ARCHITECTURE.md` §4 and D-036). At Neon Free's minimum size of 0.25 CU, an always-on compute uses 0.25 × 720 h ≈ 180 CU-hours a month, above the 100 CU-hour allowance (ADR-0009). When the allowance runs out, Neon suspends compute until the next month and the app stops.

Production uses this schedule (staging runs only the daily dispatcher):

| Cron expression (UTC) | Asia/Dhaka | Runs |
|---|---|---|
| `*/15 2-14 * * SUN-THU` | every 15 min, 08:00–20:59, Sun–Thu | `outbox.process` retries |
| `5 18 * * *` | 00:05 daily (18:05 UTC the previous day) | daily jobs (effective events, close day, reminders, prune) in sequence |

Cloudflare cron expressions are in UTC; use day names (`SUN-THU`) rather than numbers to avoid off-by-one day numbering. Rules that go with it:

- New emails are sent straight after the transaction commits, with `ctx.waitUntil()`. The cron run only retries failures, so normal emails don't wait 15 minutes.
- The dispatcher reads the outbox only when there is work to do. It must not query the database just to find out that nothing is pending.
- Monthly and yearly jobs (`leave.accrue`, `leave.year_end`) run from the daily dispatcher when the date matches.

Free Workers accounts allow a limited number of Cron Triggers per account (ADR-0009; verify the current number in the dashboard under Workers → Settings). This schedule uses 2 per environment, 4 in total.

## 5. Data rules per environment

- Production data never leaves production except as encrypted backups (`BACKUP-AND-RESTORE.md`).
- Staging may receive an anonymised copy for UAT: restore a backup to a local Postgres, run `pnpm --filter @hrm/scripts anonymise`, review the result, then load it into the Neon `staging` branch. Never restore an un-anonymised backup to staging.
- Staging email goes only to addresses in `MAIL_ALLOWLIST`, so test runs never email real employees.
