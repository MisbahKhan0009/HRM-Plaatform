# HRM Platform

An internal human resource management system for **Big-Matrix Solutions** (Bangladesh, under 50 employees). It covers employee records, attendance, leave, payroll, transport reimbursements, documents, approvals, employee self-service, reports and audit in one secure web app.

- **Status:** documentation stage (roadmap Stage 5). No application code yet. Progress: `docs/ROADMAP.md`.
- **Running cost:** $0 per month. Everything runs on free tiers (D-032).
- **Users:** HR, payroll, managers, directors, auditors and every employee, on desktop and mobile browsers.

## Quick links

| I want to | Read |
|---|---|
| Understand what v1 does | `docs/00-requirements/SCOPE-V1.md` |
| See why a decision was made | `docs/00-requirements/DECISION-LOG.md` |
| Understand the architecture | `docs/03-architecture/ARCHITECTURE.md` |
| Set up my machine | `docs/09-process/DEVELOPER-ONBOARDING.md` |
| Contribute a change | `CONTRIBUTING.md` |
| Report a vulnerability | `SECURITY.md` |
| Work as an AI coding agent | `AGENTS.md` |
| Find any document | `docs/README.md` |

## Stack

| Layer | Choice |
|---|---|
| Hosting | Cloudflare Workers Free: one Worker serves the API and the web app at a `*.workers.dev` address |
| Backend | TypeScript, Hono, Zod, OpenAPI generated from the routes |
| Database | PostgreSQL on Neon Free through Cloudflare Hyperdrive; Drizzle ORM |
| Auth | Better Auth, passwordless: passkeys or email one-time codes, TOTP for privileged roles |
| Frontend | React 19 SPA (Vite), TanStack Router, Query and Table, shadcn/ui, Tailwind CSS v4 |
| Files | Cloudflare R2 private bucket |
| Jobs and email | Postgres outbox + Cron Trigger; Gmail API |
| Quality | Vitest, Playwright, axe-core, Sentry (free), GitHub Actions |

Full details and the reasoning: `docs/01-tech-stack/TECH-STACK.md` and its ADRs.

## Repository layout

```text
apps/api          Cloudflare Worker: Hono API, cron jobs, serves the web build
apps/web          React single-page app
packages/         contracts, domain, db, auth, mailer, ui, documents, i18n, config
e2e/              Playwright tests
scripts/          backup, restore, seed, anonymise
docs/             all documentation
.claude/skills/   reviewed third-party agent skills (docs/SKILLS.md)
```

The `apps/`, `packages/`, `e2e/` and `scripts/` folders are created in roadmap Stage 7. Layout and dependency rules: `docs/03-architecture/MONOREPO.md`.

## Getting started

Follow `docs/09-process/DEVELOPER-ONBOARDING.md`. In short, once the code exists:

```sh
corepack enable && pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
docker compose up -d postgres
pnpm --filter @hrm/db db:migrate && pnpm --filter @hrm/db db:seed
pnpm dev
```

## Brand

The UI follows the Big-Matrix Solutions design system (`docs/02-brand/`), dark Ink theme by default with a light Paper toggle.
