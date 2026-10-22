# Developer onboarding

This guide takes a new developer from an empty machine to a running local app and a first merged PR, using free tools only (D-032).

> The application code is scaffolded in roadmap Stage 7. Until then, the commands in steps 4 to 6 describe the target setup; they are verified and corrected when the scaffold lands.

## 1. Read first (about 2 hours)

In this order:

1. `README.md`: what the product is.
2. `docs/00-requirements/SCOPE-V1.md` and `SRS-v1.1-CHANGES.md`: what we build in v1.
3. `docs/00-requirements/DECISION-LOG.md`: why things are the way they are.
4. `docs/03-architecture/ARCHITECTURE.md`, `DOMAIN-MODEL.md`, `SECURITY-MODEL.md`, `MONOREPO.md`.
5. `docs/01-tech-stack/TECH-STACK.md` and ADR-0009 (free-tier limits that shape the design).
6. The coding standards for your side: `docs/05-backend/CODING-STANDARDS.md` or `docs/06-frontend/CODING-STANDARDS.md`.
7. `docs/09-process/`: this folder.
8. `AGENTS.md` if you use an AI coding assistant.

## 2. Accounts you need

| Account | Why | Who grants it |
|---|---|---|
| GitHub | Repository access | Lead developer adds you to the repository |
| Cloudflare (only for deploy duties) | Staging deploys and logs | Ops; most developers never need it |
| Sentry (optional) | Reading errors | Ops; the free plan has one seat, so access is shared through the lead |

You do **not** need a Neon, Gmail or R2 account to develop: local development uses a local Postgres and local stand-ins (step 5). Account creation for the project owner is in `docs/08-operations/ACCOUNT-SETUP.md`.

## 3. Install tools

| Tool | Version | Notes |
|---|---|---|
| Git | 2.40 or later | |
| Node.js | The version in `.nvmrc` (Node 22 LTS) | Install with `nvm` or `fnm` (both free) |
| pnpm | The version in `package.json` `packageManager` | Run `corepack enable`; do not install pnpm globally with npm |
| Docker Engine or Podman | Current | Runs the local Postgres. Docker Desktop is free for companies under its size and revenue thresholds; Docker Engine (Linux) and Podman are free for everyone |
| VS Code | Current | Recommended extensions are listed in `.vscode/extensions.json` (Biome, Tailwind CSS, Playwright) |
| Playwright browsers | Installed by `pnpm exec playwright install chromium` | Only for E2E tests |

Wrangler (Cloudflare CLI) and drizzle-kit are dev dependencies of the repo; do not install them globally.

## 4. Clone and install

```sh
git clone https://github.com/MisbahKhan0009/HRM-Plaatform.git hrm-platform
cd hrm-platform
corepack enable
pnpm install
```

## 5. Configure local environment

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars
docker compose up -d postgres          # local Postgres 16 on port 5432
pnpm --filter @hrm/db db:migrate       # apply migrations
pnpm --filter @hrm/db db:seed          # synthetic company, users and employees
```

`.dev.vars` is gitignored. Locally, the mailer writes emails to the console instead of calling Gmail, and file storage uses Wrangler's local R2 simulation. Never put production credentials in `.dev.vars` (`docs/08-operations/SECRETS.md`).

## 6. Run

```sh
pnpm dev     # Vite dev server for apps/web + wrangler dev for apps/api
```

Open the URL printed by Vite. Sign in as a seeded user; the one-time code appears in the API console output. Seeded users cover every role in `docs/03-architecture/SECURITY-MODEL.md` §2.

Checks before every PR:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e        # needs Playwright browsers; CI runs it anyway
```

## 7. Your first change

1. Pick an issue labelled `good first issue`.
2. Create a branch: `feat/<area>-<short-name>` (`GIT-WORKFLOW.md`).
3. Write the test first for logic changes (the `test-driven-development` skill describes the loop).
4. Open a draft PR using the template; follow `PULL-REQUESTS.md`.
5. Meet `DEFINITION-OF-DONE.md`.

## 8. Using an AI coding assistant

Optional. The repository ships third-party skills in `.claude/skills/` (`docs/SKILLS.md`) and agent rules in `AGENTS.md`. The skills are plain Markdown and work with any assistant that reads them. Paid AI subscriptions are a personal choice, not a project requirement.

## 9. Getting help

- Architecture or product questions: the decision log first, then the lead developer.
- Undecided HR or payroll policy: never guess; raise it with the product owner and add it to the relevant "Open questions (owner)" list.
