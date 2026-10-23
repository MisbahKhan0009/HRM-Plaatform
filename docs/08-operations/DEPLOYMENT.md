# Deployment runbook

Status: **Draft.** The steps follow the CI/CD design and have not been run against real infrastructure. The first operator to deploy corrects any step that differs and updates this status line.

This is the sequence for shipping a change to staging and production, plus the first-ever deploy and rollback. Workflow internals: `CI-CD.md`. Environments and Wrangler layout: `ENVIRONMENTS.md`.

**Legend:** 🟢 safe, read-only · 🟠 changes staging · 🔴 changes production · 🖐 manual step outside the terminal

## TL;DR (normal release)

1. Merge PRs to `main` → `deploy-staging` runs automatically (migrations, then Worker). 🟠
2. Test on staging; check Sentry staging has no new errors. 🖐
3. Create and push tag `vX.Y.Z` on the tested `main` commit. 🖐
4. Run **deploy-production** from the Actions tab with `tag=vX.Y.Z`, `confirm=deploy vX.Y.Z`. 🔴
5. Run the smoke checks in §5. 🟢

## 1. Rules

- **Migrations run before the Worker deploy, and must be backward-compatible** with the Worker version that's still running (expand/contract, §4). Wrong order, or a breaking migration, means the live Worker queries columns that don't exist yet → 500 errors until the deploy finishes.
- No production deploy on the last two working days of the month or during an open payroll run in `submitted`/`approved` state, unless it is a fix for payroll itself. Payroll officers are told before any deploy in the payroll week.
- No deploy from a laptop to production. Production deploys come only from `deploy-production.yml` (`CI-CD.md` §4).

## 2. Normal release

1. 🖐 Confirm `main` is green and the last `deploy-staging` run succeeded (Actions tab).
2. 🖐 On staging, run the smoke checks in §5 plus the feature being released.
3. 🖐 Update `CHANGELOG.md` in a release PR and merge it.
4. 🖐 Tag the merge commit:

```bash
git switch main && git pull --ff-only
git tag -s v1.4.0 -m "v1.4.0"     # signed tag; use -a if signing is not set up
git push origin v1.4.0
```

5. 🔴 Actions → **deploy-production** → Run workflow → `tag: v1.4.0`, `confirm: deploy v1.4.0`.
6. 🟢 Watch the run: guard checks → `drizzle-kit migrate` on Neon `main` → `wrangler deploy --env production` → smoke test → Sentry release.
7. 🟢 Run §5 against production.
8. 🖐 Post in the team channel: version, what changed, and the rollback version (§6).

## 3. First deploy of an environment (once)

Prerequisite: `ACCOUNT-SETUP.md` done for that environment.

```bash
# 1. 🟠 Create the database schema (run as neondb_owner, direct connection)
DATABASE_URL="<owner direct string for the branch>" pnpm --filter @hrm/db db:migrate
# 2. 🟠 Reference data (company, roles, permissions, settings, leave types, default schedule) and the first
#    administrator, who signs in with an emailed code and invites everyone else. Safe to run again.
DATABASE_URL="<owner direct string>" SEED_COMPANY_NAME="Big-Matrix Solutions" \
  SEED_ADMIN_EMAIL=owner@example.com SEED_ADMIN_NAME="Owner Name" SEED_ADMIN_ROLES=system_admin,hr_admin \
  pnpm --filter @hrm/db db:seed
#    staging only: synthetic demo people (refuses a Neon URL unless SEED_DEMO_CONFIRM=staging)
DATABASE_URL="<owner staging direct string>" SEED_DEMO_CONFIRM=staging pnpm --filter @hrm/db db:seed:demo
# 3. 🟠 Build the SPA, then deploy the Worker (creates it on first deploy)
pnpm --filter @hrm/web build
pnpm --filter @hrm/api exec wrangler deploy --env staging
# 4. 🟠 Set secrets (ACCOUNT-SETUP §8), then redeploy so they're picked up
pnpm --filter @hrm/api exec wrangler secret put BETTER_AUTH_SECRET --env staging
pnpm --filter @hrm/api exec wrangler deploy --env staging
```

Production follows the same steps with `--env production` and **without** `db:seed:demo`. In production, run steps 1–2 from the owner's machine only once; every later migration runs from `deploy-production.yml`.

## 4. Database migrations: expand/contract

Every schema change that could break the running Worker is split across releases:

| Release | Migration | Code |
|---|---|---|
| N (expand) | Add the new column/table, nullable or with a default. Backfill in the same migration if it's small (< 10k rows) | New code writes both old and new; reads old |
| N+1 | — | Reads new; still writes both |
| N+2 (contract) | Drop the old column; add `NOT NULL` | Only new |

Renames are add + copy + drop, never `RENAME COLUMN` in one release. Every migration is reviewed for locks: `CREATE INDEX CONCURRENTLY` cannot run inside a transaction, so put it in its own migration file. At this data size (< 50 employees) most locks are milliseconds, but the rule keeps deploys zero-downtime by habit. More: `docs/05-backend/DATABASE-CONVENTIONS.md`.

Before every production migration, `deploy-production.yml` checks that the latest backup is less than 26 hours old. If it's older, run **nightly-backup** by hand first.

## 5. Smoke checks (run after every deploy)

```bash
BASE=https://hrm.<account-subdomain>.workers.dev        # or the staging URL

curl -fsS "$BASE/api/v1/health" | jq .                       # 🟢 {"status":"ok","db":"ok", "version":"v1.4.0"}
curl -fsS -o /dev/null -w '%{http_code}\n' "$BASE/"           # 🟢 200 (SPA shell)
curl -fsS -o /dev/null -w '%{http_code}\n' "$BASE/api/v1/auth/me"   # 🟢 401 (auth enforced)
pnpm --filter @hrm/api exec wrangler deployments list --env production   # 🟢 new version is active
```

Then, in a browser: sign in with a passkey; open the dashboard; check in and out on a test account (staging only); open Sentry and confirm no new error spike for 15 minutes.

## 6. Rollback

### 6.1 Worker only (code problem, schema compatible)

```bash
cd apps/api
pnpm exec wrangler deployments list --env production          # 🟢 find the previous version ID
pnpm exec wrangler rollback <version-id> --env production -m "rollback v1.4.0: <reason>"   # 🔴
```

Rollback restores the previous Worker code and its static assets. It doesn't touch the database or secrets. Because of expand/contract (§4), the previous Worker still works with the new schema.

### 6.2 Database migration problem

There are no automatic down-migrations. Choose one:

1. (recommended) **Fix forward:** write a new migration that corrects the problem and release it.
2. **Restore:** if data was damaged, follow `BACKUP-AND-RESTORE.md` §4 (Neon instant restore within 6 hours, otherwise the nightly backup). Restoring loses data written after the restore point; get the owner's approval first.

## 7. Verify it worked

- `GET /api/v1/health` reports the new `version`.
- `wrangler deployments list` shows the new version at 100%.
- Sentry shows the release with no new issues after 15 minutes.
- The `deploy-production` run is green, with the migration step listing the applied migration names.
