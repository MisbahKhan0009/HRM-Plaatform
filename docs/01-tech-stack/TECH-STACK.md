# Tech Stack (frozen for v1)

Status: **Accepted** — 2026-10-22 (revised for zero cost, D-032). Changes require a new ADR in `adr/`.

Hard constraints: D-024 (everything on Cloudflare Workers), **D-032 (free tiers only, $0/month)**, D-001 (SaaS-ready), D-002 (1–2 devs + AI).

| Layer | Choice | Free tier used | ADR |
|---|---|---|---|
| Language | **TypeScript** (strict) everywhere | — | 0001 |
| Runtime / hosting | **Cloudflare Workers Free**; one Worker serves SPA assets + `/api/v1` (same origin) at `*.workers.dev` | 100k req/day, **10 ms CPU/request**, 3 MB Worker; static asset requests free | 0002, 0009 |
| Backend framework | **Hono** + `@hono/zod-openapi` | OSS | 0001 |
| Validation | **Zod** schemas shared API ↔ UI (`packages/contracts`) | OSS | 0001 |
| Database | **PostgreSQL on Neon Free** via **Cloudflare Hyperdrive** | 0.5 GB, 100 CU-h/month, scale-to-zero, 6 h restore window | 0003 |
| ORM / migrations | **Drizzle ORM** + `drizzle-kit` | OSS | 0003 |
| Auth | **Better Auth**, passwordless: passkeys + email OTP, TOTP for privileged roles | OSS, stored in our DB | 0004 |
| Frontend | **React 19 SPA** (Vite), TanStack Router / Query / Table | OSS | 0005 |
| UI kit / styling | **shadcn/ui** + Tailwind CSS v4 | OSS | 0005 |
| Forms / i18n | React Hook Form + Zod; `react-i18next` | OSS | 0005 |
| Money / dates | `NUMERIC(14,2)` + `decimal.js`; `date-fns` + `@date-fns/tz` | OSS | 0006 |
| File storage | **Cloudflare R2** private bucket | 10 GB, 1M writes, 10M reads / month | 0009 |
| Background jobs | **Postgres outbox + Cron Trigger** (every minute) | Cron triggers free | 0002 |
| Email | **Gmail API** from a dedicated company Gmail account | ~500 emails/day | 0007 |
| PDF / exports | Generated **client-side**: `pdf-lib` (payslips), `exceljs`/CSV (reports) | OSS | 0006 |
| Observability | **Sentry Developer (free)** + Workers Logs | 5k errors/month, 1 seat | 0008 |
| Backups | Nightly `pg_dump` (GitHub Actions) → encrypted (`age`) → R2 | Actions free minutes | 0003 |
| Monorepo | pnpm workspaces + Turborepo | OSS | Stage 4 |
| Testing | Vitest (+ `@cloudflare/vitest-pool-workers`), Testing Library, Playwright, axe-core | OSS | 0008 |
| CI/CD | GitHub Actions → `wrangler deploy` | 2,000 min/month (private repo) | 0008 |

## Environments

| Env | Worker | Database | Data |
|---|---|---|---|
| local | `wrangler dev` | Postgres in Docker | Seed / synthetic |
| CI | — | Postgres service container in Actions (saves Neon quota) | Synthetic |
| staging | `hrm-staging.<acct>.workers.dev` | Neon `staging` branch | Synthetic (NFR-SEC-009) |
| production | `hrm.<acct>.workers.dev` | Neon `main` branch | Real; restricted access |

## Monthly cost: **$0**
Free-tier limits and how we stay within them are tracked in ADR-0009.
