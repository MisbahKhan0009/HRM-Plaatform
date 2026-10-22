# Secrets and credentials

Status: **Accepted**, 2026-10-22. Lists every secret and configuration value, where it is stored, who can read it, and how to rotate it. NFR-SEC-006: no secret is ever committed. Account creation: `ACCOUNT-SETUP.md`.

## 1. Rules

1. Secrets live in exactly one of: Cloudflare Worker secrets, GitHub Actions secrets, or the owner's password manager. Never in `wrangler.jsonc`, `.env` files that are committed, issue comments, chat or Sentry.
2. Local development uses `apps/api/.dev.vars` (gitignored). `apps/api/.dev.vars.example` is committed with names and dummy values only.
3. Each environment has its own values. Staging never uses a production secret.
4. `gitleaks` runs in CI and as a pre-commit hook (`docs/07-quality/SECURITY-TESTING.md` §8).
5. Anyone who suspects a leak follows `INCIDENT-RUNBOOKS.md` IR-08 immediately and rotates the secret.

## 2. Worker runtime secrets and variables

| Name | Kind | Envs | Purpose | Set with | Rotation |
|---|---|---|---|---|---|
| `BETTER_AUTH_SECRET` | secret | local, staging, prod (different each) | Signs session cookies and encrypts TOTP secrets | `wrangler secret put` | Yearly or after a leak. **Rotating signs everyone out**; rotating without Better Auth's secret-rotation support makes stored TOTP secrets unreadable. Check `docs/05-backend/AUTH-IMPLEMENTATION.md` before rotating. |
| `GMAIL_CLIENT_ID` | secret | staging, prod | OAuth client | `wrangler secret put` | With the client secret |
| `GMAIL_CLIENT_SECRET` | secret | staging, prod | OAuth client | `wrangler secret put` | Yearly: create a new secret in Google Cloud → Clients, update, then delete the old one |
| `GMAIL_REFRESH_TOKEN` | secret | staging, prod | Sends mail via Gmail API | `wrangler secret put` | When revoked or after a leak: redo `ACCOUNT-SETUP.md` §5.3; revoke the old one at https://myaccount.google.com/permissions |
| `SENTRY_DSN` | secret (low sensitivity) | staging, prod | Error reporting | `wrangler secret put` | Only if abused: regenerate the client key in Sentry |
| `APP_ENV`, `APP_ORIGIN`, `MAIL_MODE`, `MAIL_FROM`, `MAIL_ALLOWLIST`, `SENTRY_ENVIRONMENT` | var | all | Configuration | `wrangler.jsonc` | — |
| Hyperdrive connection string (`hrm_app` password inside) | secret, held by Cloudflare | staging, prod | DB access | `wrangler hyperdrive update <id> --connection-string=…` | Yearly: change the `hrm_app` password in Neon (`ALTER ROLE`), then update Hyperdrive straight away |
| Web SPA Sentry DSN | public | staging, prod | Browser error reporting | build-time `VITE_SENTRY_DSN` | — (DSNs are public by design) |

## 3. GitHub Actions secrets

| Name | Used by | Value | Rotation |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | deploy workflows | Token from `ACCOUNT-SETUP.md` §2.5 | Yearly; roll in Cloudflare, update secret |
| `CLOUDFLARE_ACCOUNT_ID` | deploy workflows | Account ID (not secret, kept with the token) | — |
| `NEON_STAGING_OWNER_URL` | deploy-staging (migrations) | `neondb_owner` direct string, `staging` branch | Yearly; reset password in Neon console |
| `NEON_PROD_OWNER_URL` | deploy-production (migrations), nightly-backup | `neondb_owner` direct string, `main` branch | Yearly |
| `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY` | nightly-backup, restore-drill | R2 token scoped to `hrm-backups` | Yearly |
| `R2_ENDPOINT` | nightly-backup, restore-drill | `https://<account-id>.r2.cloudflarestorage.com` | — |
| `BACKUP_AGE_RECIPIENT` | nightly-backup | `age` **public** key (`age1…`) | When the key pair is rotated |
| `BACKUP_AGE_IDENTITY` | restore-drill only | `age` **private** key | Only if you choose the automated drill (`BACKUP-AND-RESTORE.md` §2) |
| `SENTRY_AUTH_TOKEN` | deploy workflows | Sentry token, scope `project:releases` | Yearly |

If the repository has deployment environments (public repository, `ACCOUNT-SETUP.md` §7.2), production secrets go in the `production` environment and `BACKUP_AGE_IDENTITY` in `restore-drill`, so only approved runs can read them.

## 4. Kept only offline (owner's password manager)

| Item | Why offline |
|---|---|
| Account logins, 2FA recovery codes for Cloudflare, Neon, Google, Sentry, GitHub | Account recovery |
| `age` backup private key (primary copy) | Decrypts every backup; a copy in GitHub is optional (§3) |
| `neondb_owner` passwords | Break-glass DB access |
| Better Auth recovery codes of the first `system_admin` | Break-glass sign-in |

## 5. Rotation calendar

Every year in January (put it in the owner's calendar), and also immediately after anyone with access leaves:

1. Cloudflare API token.
2. R2 backup token.
3. Neon `neondb_owner` and `hrm_app` passwords (update Hyperdrive and GitHub secrets in the same sitting).
4. Gmail client secret.
5. Sentry auth token.
6. Review the account members list of every service and remove people who left.
7. Record the date in the owner's password manager.
