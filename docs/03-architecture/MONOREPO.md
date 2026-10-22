# Monorepo structure

Status: **Approved** by owner (2026-10-22). Scaffolding happens in Stage 7 (engineering foundation).

Tooling: **pnpm workspaces + Turborepo**, TypeScript strict, **Biome** for lint and format (one fast tool, free). Package scope: `@hrm/*`. Node version pinned in `.nvmrc` and the `packageManager` field.

## 1. Top-level layout

```text
hrm-platform/
├── apps/
│   ├── api/                 # Cloudflare Worker: Hono /api/v1, cron jobs, serves the built SPA
│   └── web/                 # React SPA (Vite); built output is served by apps/api
├── packages/
│   ├── contracts/           # Zod schemas, DTOs, error codes, permission codenames (shared FE ↔ BE)
│   ├── domain/              # Pure business rules: leave ledger, attendance, payroll, state machines
│   ├── db/                  # Drizzle schema, SQL migrations, seed data, DB client factory
│   ├── auth/                # Better Auth configuration (passkey, email OTP, TOTP)
│   ├── mailer/              # Mailer interface, Gmail API adapter, email templates
│   ├── ui/                  # Design system: tokens (from brand), shadcn components, brand components
│   ├── documents/           # Browser-side payslip PDF + CSV/XLSX export builders
│   ├── i18n/                # Translation catalogues (en; bn later)
│   └── config/              # Shared tsconfig, Biome, Vitest presets
├── e2e/                     # Playwright end-to-end tests (runs against the built app)
├── scripts/                 # Ops scripts: backup, restore, seed, anonymise
├── docs/                    # All documentation (see docs/README.md)
├── .github/workflows/       # CI/CD
├── .claude/skills/          # Third-party agent skills (docs/SKILLS.md)
├── AGENTS.md / CLAUDE.md    # Rules for AI agents (written in Stage 5)
├── package.json  pnpm-workspace.yaml  turbo.json  biome.json  skills-lock.json
└── README.md
```

## 2. Dependency rules (enforced)

```text
apps/web  ──► contracts, ui, documents, i18n
apps/api  ──► contracts, domain, db, auth, mailer
domain    ──► contracts            (+ decimal.js, date-fns only; NO I/O, no Hono, no Drizzle)
db        ──► contracts            (+ drizzle)
auth      ──► db
ui        ──► (react, radix, tailwind only)
contracts ──► (zod only)
```

- `apps/web` must never import `domain`, `db`, `auth` or `mailer`. Business rules live on the server (NFR-MNT-002). The UI may *preview* a value, such as leave days, but the API result is authoritative.
- `domain` is pure TypeScript, so payroll and leave rules are unit-testable without a database and portable if hosting changes.
- No package imports another package's internals: only its `exports` entry points.
- Enforced by **dependency-cruiser** (free) in CI, plus Turborepo task graph.

Internal packages are **source-only** ("just-in-time" packages): they export `.ts` files and the consuming app's bundler compiles them, so they have no build step of their own.

## 3. `apps/api` (backend)

```text
apps/api/
├── wrangler.jsonc           # Worker config: assets → ../web/dist, Hyperdrive, R2, cron, env.staging / env.production
├── src/
│   ├── index.ts             # Worker entry: fetch (Hono) + scheduled (cron dispatcher)
│   ├── app.ts               # Hono app, global middleware, mounts /api/v1 module routers
│   ├── middleware/          # request-id, error handler, session, require-permission, rate-limit, audit-context
│   ├── modules/             # One folder per domain module (see below)
│   ├── jobs/                # outbox processor, leave accrual, year-end, expiry reminders
│   └── lib/                 # db client, R2 helpers, pagination, idempotency, problem+json errors, logger
└── test/                    # API integration tests (vitest-pool-workers + real Postgres)
```

Modules: `accounts`, `organization`, `employees`, `attendance`, `leave`, `payroll`, `reimbursements`, `documents`, `approvals`, `notifications`, `reports`, `audit`, `settings`.

Each module has the same files:

| File | Responsibility | May import |
|---|---|---|
| `<m>.routes.ts` | OpenAPI route definitions; parse input, call service, shape response. **No business logic.** | service, contracts |
| `<m>.service.ts` | Use-cases: transactions, idempotency, calls domain rules, writes audit + outbox | domain, repository, policy |
| `<m>.repository.ts` | Drizzle queries only | db |
| `<m>.policy.ts` | Authorization: permission + record scope (own / team / all) | contracts |
| `<m>.test.ts` | Service and route tests, including permission/IDOR cases | — |

## 4. `apps/web` (frontend)

```text
apps/web/src/
├── main.tsx  router.tsx
├── routes/                  # TanStack Router file routes
│   ├── (auth)/              # sign-in, verify code, passkey, recovery
│   └── _app/                # authenticated shell: dashboard, me, employees, attendance, leave,
│                            # payroll, reimbursements, documents, approvals, reports, settings, audit
├── features/<module>/       # api hooks (TanStack Query), forms, tables, feature components
├── components/              # app shell, navigation, theme toggle, page layouts
└── lib/                     # api client (typed from contracts), auth client, query client, theme, format
```

Route guards read capabilities from `GET /auth/me`. Hiding UI is for convenience only; the API enforces every permission.

## 5. `packages/ui`

```text
packages/ui/
├── tokens/        # generated from docs/02-brand/source/tokens.json → CSS variables (Ink default, Paper)
├── styles/        # Tailwind v4 theme mapping tokens → utilities; fonts (Inter, Inter Tight, JetBrains Mono)
├── components/    # shadcn/ui components restyled to brand (Button, Input, Table, Dialog, Badge …)
└── brand/         # DotGrid, Glow, Eyebrow, Emphasis, Tick, StatBar, Logo
```

A script regenerates `tokens/` when the brand source changes, so brand values are never typed by hand.

## 6. Turborepo tasks

| Task | Depends on | Cached | Notes |
|---|---|---|---|
| `lint` | — | yes | Biome |
| `typecheck` | `^typecheck` | yes | `tsc --noEmit` |
| `test` | — | yes | Vitest per package |
| `build` | `^build` | yes | `web` → `dist/`; `api` bundles with Wrangler (dry-run) |
| `db:generate` / `db:migrate` | — | no | drizzle-kit, run from `packages/db` |
| `e2e` | `build` | no | Playwright |
| `deploy` | `@hrm/web#build`, `test` | no | `wrangler deploy --env <env>` |

CI runs only affected packages (`turbo run … --affected`) to stay within free GitHub Actions minutes.

## 7. Conventions

- Files and folders: `kebab-case`; React components: `PascalCase.tsx`; one component per file.
- Exports: named exports only (no default exports, except where a tool requires one).
- Imports: through package entry points (`@hrm/contracts`), never relative paths across packages.
- Environment: secrets in `.dev.vars` locally (gitignored) and `wrangler secret` remotely; never in code (NFR-SEC-006). Each app keeps a committed `.dev.vars.example`.
- Branches: `main` is protected and deploys to staging; release tags deploy to production (details in Stage 5 Git workflow doc).

## 8. Documentation layout (`docs/`)

```text
docs/
├── 00-requirements/   SRS, decision log, user stories, acceptance criteria
├── 01-tech-stack/     stack + ADRs
├── 02-brand/          brand source, app adaptation
├── 03-architecture/   system architecture, monorepo, domain model, data model, security model
├── 04-design/         IA, flows, wireframes, component specs, a11y
├── 05-backend/        coding standards, API standards, DB conventions, module guides
├── 06-frontend/       coding standards, state/data, forms, i18n, theming
├── 07-quality/        testing strategy, payroll test cases, security testing
├── 08-operations/     environments, CI/CD, deployment, backups, monitoring, runbooks
├── 09-process/        Git workflow, PR rules, definition of done, onboarding
└── 10-user-guides/    HR, payroll, manager, employee guides
```
