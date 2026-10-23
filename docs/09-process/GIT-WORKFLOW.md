# Git workflow

We use trunk-based development: `main` is always releasable, work happens on short-lived branches merged through pull requests, and releases are tags on `main`.

## Branches

| Branch | Purpose | Lifetime |
|---|---|---|
| `main` | Trunk. Protected. Every merge deploys to staging. | Permanent |
| `feat/<area>-<short-name>` | New behaviour, such as `feat/leave-cancellation` | 1 to 3 days |
| `fix/<area>-<short-name>` | Bug fix, such as `fix/attendance-midnight-checkout` | Hours to 1 day |
| `docs/<short-name>` | Documentation only | Hours |
| `chore/<short-name>` | Tooling, dependencies, CI | Hours |
| `refactor/<area>-<short-name>` | Behaviour-preserving change | 1 to 2 days |

`<area>` is a module name from `docs/03-architecture/DOMAIN-MODEL.md` (`leave`, `payroll`, `accounts` …) or `web`, `api`, `db`, `ui`, `ci`. Use lowercase and hyphens only.

Rules:

- Branch from the latest `main`. Rebase on `main` before opening a PR and again if `main` moves while your PR is open (your own branch only; never rewrite someone else's branch).
- A branch that lives longer than 3 days must be split or put behind a feature flag (a setting in the `settings` table, off by default).
- Delete the branch after merge.

## Protection on `main`

- No direct pushes, no force pushes.
- Merge only through a pull request with: green CI, one approving review, all review threads resolved, and the branch up to date with `main`.
- Merge method: **squash merge**. The squash commit message follows Conventional Commits (below) and becomes the changelog line.

## Commit messages: Conventional Commits

```text
<type>(<scope>): <summary in imperative mood, max 72 chars>

<body: what and why, wrapped at 72 columns, optional>

<footer: BREAKING CHANGE: …, Refs #123, optional>
```

| Type | Use for |
|---|---|
| `feat` | New user-visible behaviour |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change with no behaviour change |
| `test` | Tests only |
| `chore` | Tooling, config, dependencies |
| `ci` | CI/CD workflows |
| `perf` | Performance improvement |
| `build` | Build system |

`<scope>` is the same `<area>` used in branch names. Examples:

```text
feat(leave): reserve balance for pending requests
fix(attendance): attach after-midnight check-out to the check-in work date
docs(backend): document idempotency for payroll lock
```

Commits on your branch may be messy; the squash commit must be clean.

## Database migrations and branches

- A migration is generated on the branch that needs it (`pnpm --filter @hrm/db db:generate`).
- Two open branches that both add migrations will conflict on merge. The second to merge rebases, deletes its generated migration and regenerates it. Never edit a migration that is already on `main` (`docs/05-backend/DATABASE-CONVENTIONS.md`).

## Releases

- Staging: every merge to `main` deploys automatically.
- Production: create an annotated tag `vMAJOR.MINOR.PATCH` on a `main` commit that is green on staging. The deploy workflow waits for a manual approval. Details: `docs/08-operations/DEPLOYMENT.md`.
- Versioning: Semantic Versioning. Before v1.0.0 go-live, tags are `v0.x.y`.
- Hotfix: branch `fix/…` from `main`, merge, tag a patch version. There are no long-lived release branches.

## What never goes into Git

Secrets (`.dev.vars`, tokens, keys), production data or exports, generated build output (`dist/`), `node_modules/`. See `docs/08-operations/SECRETS.md`.
