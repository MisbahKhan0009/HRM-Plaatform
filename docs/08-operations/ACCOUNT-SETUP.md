# Account setup runbook

Status: **Draft.** No step has been run yet. The first person to run it corrects any step that differs from what they see and changes this status line. Dashboards change often; where a menu path differs, follow the provider's current wording.

This runbook creates every external account and resource the HRM needs, all on free plans (D-032). It covers creation only. Configuration values go into `ENVIRONMENTS.md`, secret values into the stores listed in `SECRETS.md`, and the first deploy is in `DEPLOYMENT.md`.

**Legend:** 🟢 safe, read-only · 🟠 creates or changes a resource · 🖐 manual step in a web dashboard

## TL;DR

1. Create a shared operations mailbox and enable 2FA on it.
2. Cloudflare: account, Workers subdomain, R2 (card on file for verification only), two R2 buckets per environment plus a backup bucket, API tokens.
3. Neon: project in Singapore, `staging` branch, app role, connection strings.
4. Hyperdrive: one configuration per environment.
5. Google: dedicated Gmail account, Cloud project, Gmail API, OAuth client, refresh token.
6. Sentry: Developer plan, two projects.
7. GitHub: repository settings, Actions secrets, Dependabot.
8. Record every owner and every token in the table in §9.

## 0. Ownership and 2FA rules

- Every account has **two named owners**: the company owner (Misbah) and one backup person. Losing the only admin of any of these accounts can stop the app.
- Use the shared operations mailbox (for example `ops.bigmatrix@gmail.com`) as the login for Cloudflare, Neon, Sentry and the Google Cloud project, not a personal address.
- Turn on 2FA (authenticator app) on every account **before** creating resources. Store recovery codes in the owner's password manager.
- No account in this runbook needs a paid plan. If any screen asks you to choose a plan, choose Free or Developer. The one place that asks for a payment card is Cloudflare R2 (§2.3).

## 1. Prerequisites

| Tool | Check | Install |
|---|---|---|
| Node.js (version in `.nvmrc`) | `node -v` | https://nodejs.org or `nvm install` |
| pnpm (version in `package.json` → `packageManager`) | `pnpm -v` | `corepack enable` |
| Wrangler (repo dependency) | `pnpm --filter @hrm/api exec wrangler --version` | installed by `pnpm install` |
| `psql` client | `psql --version` | OS package `postgresql-client` |
| `age` | `age --version` | https://github.com/FiloSottile/age |

## 2. Cloudflare

### 2.1 Account 🖐

1. Sign up at https://dash.cloudflare.com/sign-up with the operations mailbox. Enable 2FA under **My Profile → Authentication**.
2. Add the backup owner: **Manage Account → Members → Invite**, role Super Administrator.
3. Open **Workers & Pages**. Cloudflare asks you to pick a `workers.dev` subdomain. Choose it with care, for example `bigmatrix`: it becomes part of the app URL (`hrm-prod.bigmatrix.workers.dev`), and passkeys are tied to that URL (ADR-0004).
4. Stay on the **Workers Free** plan. Do not upgrade.

### 2.2 Log in Wrangler 🟠

```bash
pnpm --filter @hrm/api exec wrangler login      # opens a browser; approve
pnpm --filter @hrm/api exec wrangler whoami      # 🟢 shows the account name and ID
```

Write the **Account ID** into the table in §9.

### 2.3 R2 buckets 🖐 🟠

1. Dashboard → **R2 Object Storage** → **Purchase R2 / Enable**. Cloudflare asks for a payment method (card or PayPal) before R2 can be used. **This is verification only.** The free allowance (10 GB storage, 1M Class A and 10M Class B operations a month) is not charged (D-034). Usage above the free allowance would be charged, so `FREE-TIER-MONITORING.md` checks it monthly.
2. Create the buckets, location hint Asia-Pacific:

```bash
pnpm --filter @hrm/api exec wrangler r2 bucket create hrm-staging-files --location apac
pnpm --filter @hrm/api exec wrangler r2 bucket create hrm-prod-files    --location apac
pnpm --filter @hrm/api exec wrangler r2 bucket create hrm-backups       --location apac
pnpm --filter @hrm/api exec wrangler r2 bucket list                     # 🟢 verify
```

3. Confirm public access is **off** for all three buckets: dashboard → R2 → bucket → **Settings** → Public access: *Disabled*, no custom domain, `r2.dev` URL *Disabled* (FR-DOC-008).
4. Lifecycle rules on `hrm-backups` (dashboard → bucket → Settings → Object lifecycle rules):
   - Rule `daily-expire`: prefix `daily/`, delete objects 30 days after upload.
   - Rule `monthly-expire`: prefix `monthly/`, delete objects 365 days after upload.

### 2.4 R2 API token for backups 🖐

Dashboard → R2 → **Manage R2 API Tokens** → Create API token:
- Permissions: **Object Read & Write**
- Apply to specific buckets only: `hrm-backups`
- TTL: none (rotate yearly, `SECRETS.md`)

Copy the **Access Key ID**, **Secret Access Key** and the S3 endpoint (`https://<account-id>.r2.cloudflarestorage.com`). They're shown once. Put them straight into GitHub secrets (§7.3).

### 2.5 Cloudflare API token for CI deploys 🖐

**My Profile → API Tokens → Create Token** → template **Edit Cloudflare Workers**.
- Account resources: include only this account.
- Zone resources: none needed (no custom domain).
- Add permission: Account → **Hyperdrive → Read** (needed when Wrangler resolves bindings).

Save the token into GitHub secrets as `CLOUDFLARE_API_TOKEN` (§7.3).

## 3. Neon 🖐 🟠

1. Sign up at https://console.neon.tech with the operations mailbox; enable 2FA. Plan: **Free**.
2. Create project: name `hrm`, Postgres version: the default offered, region **AWS Asia Pacific (Singapore)**. Note the Postgres major version in §9; the CI and local Docker images must use the same major version.
3. The default branch is `main` (production). Create branch `staging` from `main` (**Branches → New branch**). Neon Free allows 10 branches per project.
4. Set **Compute → Scale to zero** on for both branches (the Free default: suspend after 5 minutes).
5. Add the backup owner to the project (**Settings → Collaborators** or the organisation members page).
6. Create the application role on each branch. Run with the owner connection string (**Connect** button → role `neondb_owner`, *direct* connection, not pooled):

```bash
psql "<owner direct connection string for the branch>" <<'SQL'
CREATE ROLE hrm_app LOGIN PASSWORD '<generate 32+ random chars>';
GRANT CONNECT ON DATABASE neondb TO hrm_app;
GRANT USAGE ON SCHEMA public TO hrm_app;
SQL
```

Table-level grants for `hrm_app` (including **no** `UPDATE`/`DELETE` on `audit_logs`) are applied by the migrations (`docs/05-backend/DATABASE-CONVENTIONS.md`). Migrations run as `neondb_owner`; the Worker connects as `hrm_app`.

7. Record for each branch: the **direct** connection string for `neondb_owner` (CI migrations and backups) and for `hrm_app` (Hyperdrive). Both are secrets (`SECRETS.md`).

## 4. Hyperdrive 🟠

Hyperdrive pools connections itself, so give it Neon's **direct** (non-pooled) connection string for the `hrm_app` role.

```bash
pnpm --filter @hrm/api exec wrangler hyperdrive create hrm-staging-db \
  --connection-string="postgres://hrm_app:<password>@<staging-direct-host>/neondb?sslmode=require"
pnpm --filter @hrm/api exec wrangler hyperdrive create hrm-prod-db \
  --connection-string="postgres://hrm_app:<password>@<main-direct-host>/neondb?sslmode=require"
pnpm --filter @hrm/api exec wrangler hyperdrive list                      # 🟢 verify
```

Copy each configuration **ID** into `apps/api/wrangler.jsonc` (`ENVIRONMENTS.md` §2). Hyperdrive is included in Workers Free with a daily query limit (ADR-0009; check the current limit in the dashboard under Hyperdrive).

## 5. Google: Gmail sender (ADR-0007) 🖐

### 5.1 Dedicated Gmail account
1. Create a new Gmail account used only for sending HRM email, for example `hrm.bigmatrix@gmail.com`. Display name: `Big-Matrix HRM`.
2. Enable 2-Step Verification. Add both owners' phone numbers as recovery options, and store backup codes. If this account is lost, users without a passkey can't sign in (THREAT-MODEL T-16).

### 5.2 Google Cloud project and Gmail API
Sign in to https://console.cloud.google.com **as the dedicated Gmail account** (no billing account is needed for the Gmail API).
1. Create project `bigmatrix-hrm`.
2. **APIs & Services → Library → Gmail API → Enable.**
3. **Google Auth Platform → Branding / OAuth consent screen**: user type **External**; app name `Big-Matrix HRM`; support email and developer contact = the dedicated account.
4. **Data access / Scopes**: add only `https://www.googleapis.com/auth/gmail.send`.
5. **Audience / Test users**: add the dedicated account.
6. **Publish the app** (Publishing status → *In production*). This matters: while an app is in *Testing*, Google expires its refresh tokens after 7 days and email would stop every week. The app stays *unverified*, which is acceptable because the only user who ever authorises it is the dedicated account itself. You will see an "unverified app" warning once, in §5.3.
7. **Clients → Create client → Web application**, name `hrm-mailer`, authorised redirect URI `https://developers.google.com/oauthplayground`. Copy the **Client ID** and **Client secret**.

### 5.3 Refresh token
1. Open https://developers.google.com/oauthplayground. Gear icon → tick **Use your own OAuth credentials** → paste the Client ID and secret.
2. Step 1: enter scope `https://www.googleapis.com/auth/gmail.send` → **Authorize APIs** → sign in as the dedicated account → accept the unverified-app warning (**Advanced → Go to Big-Matrix HRM**).
3. Step 2: **Exchange authorization code for tokens.** Copy the **Refresh token**.
4. Store `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` as Worker secrets (§8). Then close the Playground tab.

## 6. Sentry 🖐

1. Sign up at https://sentry.io with the operations mailbox; plan **Developer (free)**: 1 seat, 5k errors a month (ADR-0009). Enable 2FA. Data storage location: choose the region offered nearest Bangladesh.
2. Create project `hrm-api` (platform: Cloudflare Workers) and project `hrm-web` (platform: React). Copy each **DSN**.
3. **Settings → Security & Privacy**: enable *Data Scrubber* and *Use Default Scrubbers*; set *Prevent Storing of IP Addresses* on (`OBSERVABILITY.md` §4).
4. Create an **auth token** (Settings → Auth Tokens) with scope `project:releases` only, for uploading source maps from CI. Store it as GitHub secret `SENTRY_AUTH_TOKEN`.
5. Alerts: email to the operations mailbox (`OBSERVABILITY.md` §6).

## 7. GitHub

### 7.1 Repository settings 🖐
- **Settings → General**: disable merge commits or squash per `docs/09-process/GIT-WORKFLOW.md`; enable *Automatically delete head branches*.
- **Settings → Actions → General**: *Allow actions created by GitHub* + *Allow specified actions* listed in `CI-CD.md` §5; *Workflow permissions*: **Read repository contents** (default token read-only); do not allow Actions to create or approve PRs.
- **Settings → Code security**: enable Dependabot alerts and Dependabot security updates; enable secret scanning if offered for the repository.

### 7.2 Branch protection and environments 🖐
GitHub Free offers branch protection rules and deployment environments on **public** repositories only; a **private** repository on GitHub Free does not get them. Check under Settings → Branches / Environments.

| If the repository is | Do this |
|---|---|
| Public | Protect `main`: require a PR, require status check `ci`, block force-push and deletion. Create environments `staging`, `production` (required reviewer: owner) and `restore-drill` (required reviewer: owner), and put deploy and backup secrets in them |
| Private (GitHub Free) | No protection rules are available. Compensating controls: production deploys run only on a signed release tag plus a manual `workflow_dispatch` confirmation input (`CI-CD.md` §4); only the owner and one backup person have write access; review the Actions log after every production deploy |

**Decided: public** (D-043). Apply the *Public* row. Because the code is public, never commit secrets, real employee data, `.dev.vars` or database dumps; secret scanning and push protection must be enabled (free for public repositories).

### 7.3 Actions secrets 🖐
**Settings → Secrets and variables → Actions** (or per environment if environments exist). The full list with rotation rules is in `SECRETS.md` §3.

### 7.4 Dependabot 🟠
Commit `.github/dependabot.yml` with weekly updates for `npm` (root) and `github-actions`. Done in Stage 7 scaffolding.

## 8. Worker secrets 🟠

Run once per environment after the first deploy has created the Worker (`DEPLOYMENT.md` §3). Each command prompts for the value, so it never lands in shell history.

```bash
cd apps/api
for s in BETTER_AUTH_SECRET GMAIL_CLIENT_ID GMAIL_CLIENT_SECRET GMAIL_REFRESH_TOKEN SENTRY_DSN; do
  pnpm exec wrangler secret put "$s" --env staging
done
pnpm exec wrangler secret list --env staging        # 🟢 names only, values are never shown
```

Repeat with `--env production`. Use a **different** `BETTER_AUTH_SECRET` per environment (generate with `openssl rand -base64 48`).

## 9. Record of accounts

Fill in when done. Store this table in the owner's password manager, **not** in the repository. Only the empty template lives here.

| Account / resource | Login | Owner 1 | Owner 2 | 2FA on | ID / note |
|---|---|---|---|---|---|
| Operations mailbox | | | | ☐ | |
| Cloudflare account | | | | ☐ | Account ID: |
| Workers subdomain | — | | | — | `<subdomain>.workers.dev` |
| R2 buckets | — | | | — | `hrm-staging-files`, `hrm-prod-files`, `hrm-backups` |
| Neon project | | | | ☐ | Region, Postgres major version: |
| Hyperdrive | — | | | — | staging ID, prod ID |
| Gmail sender | | | | ☐ | |
| Google Cloud project | (Gmail sender) | | | ☐ | project ID |
| Sentry | | | | ☐ | org slug |
| GitHub repository | | | | ☐ | public / private |
| `age` backup key pair | — | | | — | where the private key is stored (§ `BACKUP-AND-RESTORE.md` §2) |

## 10. Verify it worked

```bash
pnpm --filter @hrm/api exec wrangler whoami              # account visible
pnpm --filter @hrm/api exec wrangler r2 bucket list      # three buckets
pnpm --filter @hrm/api exec wrangler hyperdrive list     # two configurations
psql "<hrm_app staging direct string>" -c 'select 1'     # app role connects
```

Then do the first staging deploy (`DEPLOYMENT.md` §3) and send yourself a sign-in code. Receiving it proves the Gmail setup.
