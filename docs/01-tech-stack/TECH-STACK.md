# Tech Stack (frozen for v1)

Status: **Accepted** — 2026-10-22. Changes require a new ADR in `adr/`.

Driven by D-024 (everything on Cloudflare Workers), D-001 (SaaS-ready), D-002 (1–2 devs + AI).

| Layer | Choice | ADR |
|---|---|---|
| Language | **TypeScript** (strict) everywhere | ADR-0001 |
| Runtime / hosting | **Cloudflare Workers** (Workers Paid plan); one Worker serves SPA assets + `/api/v1` (same origin) | ADR-0002 |
| Backend framework | **Hono** + `@hono/zod-openapi` (routes, validation and OpenAPI from one source) | ADR-0001 |
| Validation | **Zod** schemas shared between API and frontend (`packages/contracts`) | ADR-0001 |
| Database | **PostgreSQL on Neon**, accessed via **Cloudflare Hyperdrive** | ADR-0003 |
| ORM / migrations | **Drizzle ORM** + `drizzle-kit` SQL migrations | ADR-0003 |
| Auth | **Better Auth**: email/password, TOTP 2FA + recovery codes, DB sessions in Postgres, HttpOnly secure cookies; bearer tokens later for native apps (D-004) | ADR-0004 |
| Frontend | **React 19 SPA** built with **Vite**; **TanStack Router** (typed file routes), **TanStack Query**, **TanStack Table** | ADR-0005 |
| UI kit / styling | **shadcn/ui** (Radix primitives) + **Tailwind CSS v4**; design tokens as CSS variables | ADR-0005 |
| Forms | React Hook Form + Zod resolver | ADR-0005 |
| i18n | `react-i18next` (English v1, Bangla-ready — D-003) | ADR-0005 |
| Money / dates | Money in Postgres `NUMERIC(14,2)`, `decimal.js` in code, never JS `number`; dates via `date-fns` + `@date-fns/tz` (`Asia/Dhaka`) | ADR-0006 |
| File storage | **Cloudflare R2** private bucket; downloads streamed through an authorized endpoint or short-lived signed URLs | ADR-0002 |
| Background jobs | **Cloudflare Queues** (emails, exports) + **Cron Triggers** (leave accrual/year-end, expiry reminders) | ADR-0002 |
| Email | **Cloudflare Email Service** (Email Sending, `send_email` binding) — public beta, Workers Paid | ADR-0007 |
| PDF payslips | `pdf-lib` generation in Worker; stored in R2 | ADR-0006 |
| Exports | CSV (native) + XLSX (`exceljs`) via queued jobs | — |
| Observability | **Sentry** (FE + BE errors, alerts) + **Workers Logs** (structured JSON logs) | ADR-0008 |
| Monorepo | **pnpm workspaces + Turborepo** | Stage 4 |
| Lint / format | Biome (or ESLint + Prettier — decided in Stage 4) | Stage 4 |
| Testing | **Vitest** (+ `@cloudflare/vitest-pool-workers` for API), Testing Library, **Playwright** E2E, axe for a11y | ADR-0008 |
| CI/CD | **GitHub Actions** → `wrangler deploy`; preview/staging/production environments; Neon branch per PR | ADR-0008 |

## Environments

| Env | Worker | Database | Data |
|---|---|---|---|
| local | `wrangler dev` | Local Postgres (Docker) or Neon dev branch | Seed / synthetic |
| CI / preview | per-PR preview | Neon branch per PR | Synthetic |
| staging | `hrm-staging` | Neon `staging` branch | Synthetic / anonymized (NFR-SEC-009) |
| production | `hrm-prod` | Neon `main` | Real; restricted access |

## Monthly cost estimate (<50 employees)
Workers Paid $5 · Neon Launch ~$19 (or Free for staging) · R2/Queues/Hyperdrive/Email ≈ $0–2 · Sentry free · **≈ $25/month**.
