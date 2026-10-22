# CI/CD

Status: **Accepted (design)**, 2026-10-22. The workflow files are written in Stage 7; this document is their specification. Deploy procedure: `DEPLOYMENT.md`. Backups: `BACKUP-AND-RESTORE.md`. Platform: GitHub Actions on the free plan (ADR-0008, ADR-0009).

## 1. Workflows

| File | Trigger | Jobs | Secrets |
|---|---|---|---|
| `.github/workflows/ci.yml` | `pull_request` to `main`; `push` to `main`; `workflow_call` | install → lint, typecheck, unit/integration tests (Postgres service), build, budgets, boundaries, security scans, E2E (Chromium) | **none** |
| `.github/workflows/deploy-staging.yml` | `push` to `main` | calls `ci.yml` → migrate Neon `staging` → deploy `hrm-staging` → smoke test | Cloudflare, `NEON_STAGING_OWNER_URL`, Sentry |
| `.github/workflows/deploy-production.yml` | `push` of tag `v*.*.*` **and** `workflow_dispatch` with input `confirm: "deploy <tag>"` | verify the tag is on `main` and staging is green → migrate Neon `main` → deploy `hrm-prod` → smoke test → Sentry release | Cloudflare, `NEON_PROD_OWNER_URL`, Sentry |
| `.github/workflows/nightly.yml` | `schedule: "30 20 * * *"` (02:30 Asia/Dhaka) | full E2E on Chromium, Firefox, WebKit and mobile viewports against a local build; Lighthouse CI against staging; `pnpm audit`, `osv-scanner` | none |
| `.github/workflows/nightly-backup.yml` | `schedule: "0 21 * * *"` (03:00 Asia/Dhaka); `workflow_dispatch` | `pg_dump` prod → `age` encrypt → upload to R2 → verify | `NEON_PROD_OWNER_URL`, R2 backup keys, `BACKUP_AGE_RECIPIENT` |
| `.github/workflows/restore-drill.yml` | `workflow_dispatch`; `schedule: "0 4 1 1,4,7,10 *"` (quarterly) | download latest backup → decrypt → restore into a Postgres service container → sanity queries | R2 backup keys, `BACKUP_AGE_IDENTITY` (only if the automated drill is chosen, `BACKUP-AND-RESTORE.md` §2) |

Scheduled workflows run on the default branch only. GitHub may delay scheduled runs at busy times. The backup job tolerates that: it checks the time of the last successful backup, not the clock.

## 2. `ci.yml` in detail

```text
install      pnpm install --frozen-lockfile (pnpm store cached by lockfile hash)
             turbo cache restored from actions/cache (key: os + lockfile + sha)
lint         pnpm turbo run lint --affected
typecheck    pnpm turbo run typecheck --affected
test         services: postgres:<Neon major version>  (health-checked)
             pnpm turbo run test --affected   (coverage gates in TESTING-STRATEGY §5)
build        pnpm turbo run build --affected
budgets      Worker bundle ≤ 2 MB gzip (PERFORMANCE-BUDGETS PB-03)
             SPA initial JS ≤ 200 KB gzip (PB-06)
             grep: "__test_login" must not appear in the production bundle
boundaries   dependency-cruiser on apps/ and packages/ (MONOREPO §2)
openapi      generated spec matches committed spec; contract tests
migrations   drizzle-kit check; migrate up from empty on the service Postgres
security     pnpm audit --prod --audit-level=high · osv-scanner · semgrep OSS · gitleaks
e2e          Playwright Chromium against `wrangler dev` + seeded service Postgres
```

`--affected` compares with the PR's base branch. Checkout uses `fetch-depth: 0` so Turborepo can see the base commit. On `push` to `main`, all tasks run, using the cache.

The required status check name for branch protection (if available, `ACCOUNT-SETUP.md` §7.2) is `ci`, a final job that `needs` every other job.

## 3. Minute budget

The repository is public (D-043), so standard GitHub-hosted runner minutes are free and unlimited. Keep the affected-only runs anyway, for speed.

| Workflow | Est. minutes per run | Runs / month | Minutes / month |
|---|---|---|---|
| `ci.yml` (affected-only, cached) | 8 | 80 (PRs + pushes) | 640 |
| `deploy-staging.yml` (incl. CI) | 11 | 40 | 440 |
| `deploy-production.yml` | 4 | 4 | 16 |
| `nightly.yml` | 15 | 30 | 450 |
| `nightly-backup.yml` | 2 | 30 | 60 |
| `restore-drill.yml` | 4 | 1 | 4 |
| **Total** | | | **≈ 1,610** |

If usage passes 1,600 minutes in a month (Settings → Billing → Usage), first cut `nightly.yml` to Sunday and Wednesday only. Check usage monthly (`FREE-TIER-MONITORING.md`).

## 4. Production deploy guard

The repository is **public** (D-043), so branch protection on `main` and the `production` environment with the owner as required reviewer are available for free and are **mandatory**. `deploy-production.yml` also keeps these checks as defence in depth:

1. Triggered only by `workflow_dispatch` with inputs `tag` and `confirm`; the job fails unless `confirm == "deploy " + tag`.
2. The job fails unless `tag` exists, matches `v<major>.<minor>.<patch>`, points to a commit on `main`, and that commit has a successful `deploy-staging` run.
3. The job fails unless `github.actor` is in a committed allow-list file `.github/deployers.txt`.
4. The job declares `environment: production`, which waits for the owner's approval in GitHub.

## 5. Allowed actions

Keep third-party actions to a minimum. Run CLIs (Wrangler, Sentry CLI, Semgrep, gitleaks, osv-scanner, aws CLI for R2) as commands, not wrapper actions.

| Action | Why |
|---|---|
| `actions/checkout` | checkout |
| `actions/setup-node` | Node from `.nvmrc` |
| `pnpm/action-setup` | pnpm from `packageManager` |
| `actions/cache` | pnpm store and Turborepo cache |
| `actions/upload-artifact` | Playwright reports, Lighthouse results |

Every `uses:` is pinned to a full commit SHA with the version as a comment, for example `uses: actions/checkout@<40-char-sha> # v4.x.y`. Dependabot keeps the SHAs current.

## 6. Hardening rules (review with the `gha-security-review` skill)

1. Top-level `permissions: contents: read`. Jobs widen only what they need (none needs write in v1).
2. **Never use `pull_request_target`** or `workflow_run` on untrusted code. PR workflows get no secrets.
3. `actions/checkout` with `persist-credentials: false`.
4. Never interpolate `${{ github.event.* }}` (titles, branch names, comments) into `run:` scripts. Pass them through `env:` and quote them.
5. Every job has `timeout-minutes`.
6. `concurrency:` groups: one deploy per environment at a time (`cancel-in-progress: false` for deploys, `true` for CI on the same PR).
7. Secrets are passed to steps through `env:` only where used, never echoed; `set -euo pipefail` in shell steps.
8. Fork PRs run `ci.yml` without secrets (the default for `pull_request`).
9. Changes to `.github/workflows/**` and `.github/deployers.txt` need the owner's review (`CODEOWNERS`).

## 7. Releases

- Version: SemVer tags `vMAJOR.MINOR.PATCH` on `main`.
- Changelog: `CHANGELOG.md`, updated in the release PR (`docs/09-process/GIT-WORKFLOW.md`).
- Sentry release name = tag; source maps uploaded by the deploy workflow, then deleted from the build output so they're never served.
