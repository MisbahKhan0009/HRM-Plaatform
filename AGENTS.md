# Agent instructions

## Read before changing code
| Need | File |
|---|---|
| Scope and stories | `docs/00-requirements/SCOPE-V1.md`, `docs/00-requirements/USER-STORIES.md` |
| Decisions (binding) | `docs/00-requirements/DECISION-LOG.md`, `docs/01-tech-stack/adr/` |
| Modules, enums, state machines | `docs/03-architecture/DOMAIN-MODEL.md` |
| Roles, permissions, scopes | `docs/03-architecture/SECURITY-MODEL.md` |
| Layout and dependency rules | `docs/03-architecture/MONOREPO.md` |
| Tables and constraints | `docs/03-architecture/DATA-MODEL.md` |
| Backend rules | `docs/05-backend/CODING-STANDARDS.md`, `API-STANDARDS.md`, `BUSINESS-RULES.md` |
| Frontend rules | `docs/06-frontend/CODING-STANDARDS.md`, `THEMING-AND-TOKENS.md` |
| Testing | `docs/07-quality/TESTING-STRATEGY.md` |
| Done criteria | `docs/09-process/DEFINITION-OF-DONE.md` |

## Package manager and commands
- Use **pnpm** only (`corepack enable`); never npm or yarn.

| Task | Command |
|---|---|
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Test one file | `pnpm vitest run path/to/file.test.ts` |
| Affected tests | `pnpm turbo run test --affected` |
| New migration | `pnpm --filter @hrm/db db:generate` |
| E2E | `pnpm e2e` |

## Layering
- Routes parse input and call services; no business logic or SQL in routes.
- Business rules go in `packages/domain` (pure, no I/O) or a module service.
- `apps/web` never imports `@hrm/domain`, `@hrm/db`, `@hrm/auth` or `@hrm/mailer`.
- Import other packages only through their entry point (`@hrm/contracts`), never by relative path.
- Use canonical names from `DOMAIN-MODEL.md` and `SECURITY-MODEL.md`; never invent enum values, roles or permissions.

## Security non-negotiables
- Every endpoint checks permission and scope through the module policy.
- Self-service endpoints take the employee from the session, never from the request body or URL.
- Out-of-scope records return 404.
- Return per-permission DTOs; never serialize a database row; never put salary in employee payloads.
- No secrets, OTPs, tokens or personal data in logs, audit metadata, fixtures or commits.
- Audit row and outbox row are written in the same transaction as the business change.

## Money, dates, state
- Money: `NUMERIC(14,2)` in SQL, `decimal.js` in code, strings on the wire; JavaScript `number` is forbidden for money.
- Timestamps: `timestamptz` UTC. Business dates: `Asia/Dhaka` via `@date-fns/tz`.
- State changes only through the transitions in `DOMAIN-MODEL.md` §5.
- Never edit a migration that is on `main`.

## Free-only and CPU budget
- No paid service, paid tier or paid feature suggested by a skill (D-032).
- Workers Free allows 10 ms CPU per request: no password hashing, no PDF or XLSX generation, no large loops in the Worker (ADR-0009).

## Policy gaps
- Never invent HR or payroll policy. Add the question to the relevant "Open questions (owner)" list and stop.

## Tests
- Every endpoint: success, validation error, unauthorized role, and out-of-scope (404) tests.
- Payroll and leave arithmetic: property-based tests (`fast-check`).

## Skills (`docs/SKILLS.md`)
| Task | Load |
|---|---|
| Any document | `technical-writing` (+ `writing-runbooks`, `recording-decisions`, `documenting-contracts`, `writing-design-docs`) |
| Hono routes and middleware | `hono` |
| Worker config, bindings, deploys | `workers-best-practices`, `wrangler`, `cloudflare` |
| Schema, migrations, SQL | `supabase-postgres-best-practices`, `neon-postgres` |
| Auth | `better-auth-best-practices`, `better-auth-security-best-practices`, `two-factor-authentication-best-practices` |
| React components | `vercel-react-best-practices`, `vercel-composition-patterns`, `shadcn`, `frontend-design` |
| Routing and data loading | `tanstack-router-core`, `tanstack-react-router`, `tanstack-router-query` |
| UI review | `web-design-guidelines` |
| Tests | `vitest`, `playwright-best-practices`, `property-based-testing`, `test-driven-development` |
| Security review | `security-review`, `differential-review`, `sharp-edges`, `gha-security-review` |
| Monorepo and build | `turborepo`, `pnpm`, `vite` |

## Commits
- Conventional Commits: `feat(leave): reserve balance for pending requests` (`docs/09-process/GIT-WORKFLOW.md`).
- Never commit to `main` directly.
