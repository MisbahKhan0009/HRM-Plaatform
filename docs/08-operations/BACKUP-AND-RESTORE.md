# Backup and restore runbook

Status: **Draft.** Not yet run. The first quarterly drill (§5) turns it into a tested runbook; record the result in §6.

Meets NFR-OPS-002 (automated backups), NFR-OPS-003 (tested, documented restore), NFR-OPS-004 (RTO ≤ 4 h) and NFR-OPS-005 (RPO ≤ 24 h). Uses only free services: GitHub Actions, R2 within its free allowance, `age` and `pg_dump` (D-032).

**Legend:** 🟢 safe, read-only · 🟠 writes to a non-production target · 🔴 writes to production · 🖐 manual step

## 1. What is backed up

| Data | Backup | Retention | Restore point |
|---|---|---|---|
| Neon `main` (all business data, audit log, auth tables) | Neon instant restore (built in) | 6 hours (Free, ADR-0003) | Any second in the last 6 h |
| Neon `main` | Nightly `pg_dump`, encrypted, in R2 `hrm-backups/daily/` | 30 days | 03:00 Asia/Dhaka each day |
| Neon `main` | Copy of the 1st-of-month dump in `hrm-backups/monthly/` | 12 months | 03:00 on the 1st |
| R2 `hrm-prod-files` (documents, receipts) | **Not backed up in v1** | — | — |
| Configuration | Git (code, `wrangler.jsonc`); secrets in the owner's password manager (`SECRETS.md`) | — | — |

R2 objects aren't copied anywhere in v1. Copying them to a second free store would double the storage use against the 10 GB allowance. Cloudflare R2 stores data redundantly, but it has no versioning to protect against deleting a file by mistake. The document module never hard-deletes on user action (`DOMAIN-MODEL.md` §2). This is a known gap; the owner decides if it's acceptable (GO-LIVE-CHECKLIST).

## 2. Encryption key (`age`)

Backups are encrypted with `age` before they leave the GitHub runner. R2 only ever stores ciphertext.

Create the key pair once, on the owner's machine:

```bash
age-keygen -o hrm-backup.key        # prints "Public key: age1…"
```

- **Public key** (`age1…`) → GitHub secret `BACKUP_AGE_RECIPIENT`.
- **Private key** file `hrm-backup.key` → owner's password manager, plus a printed or offline copy kept by the second owner. **If every copy of the private key is lost, every backup is unreadable.**
- Automated drill (optional): also store the private key as GitHub secret `BACKUP_AGE_IDENTITY`. This makes the drill hands-free, but anyone who can change workflows could read it. With a private repository without environments (`ACCOUNT-SETUP.md` §7.2), the **recommended** choice is the manual drill (§5, option B), which keeps the private key off GitHub.

## 3. Nightly backup (automated)

`nightly-backup.yml` (`CI-CD.md` §1) does this every night at 03:00 Asia/Dhaka:

```bash
set -euo pipefail
STAMP=$(date -u +%Y-%m-%dT%H%MZ)
# pg_dump major version must be >= the Neon server major version (ACCOUNT-SETUP §9)
pg_dump "$NEON_PROD_OWNER_URL" --format=custom --no-owner --no-privileges \
  --file="hrm-$STAMP.dump"
pg_restore --list "hrm-$STAMP.dump" > /dev/null          # fails if the archive is corrupt
sha256sum "hrm-$STAMP.dump" > "hrm-$STAMP.dump.sha256"
age -r "$BACKUP_AGE_RECIPIENT" -o "hrm-$STAMP.dump.age" "hrm-$STAMP.dump"
aws s3 cp "hrm-$STAMP.dump.age"    "s3://hrm-backups/daily/" --endpoint-url "$R2_ENDPOINT"
aws s3 cp "hrm-$STAMP.dump.sha256" "s3://hrm-backups/daily/" --endpoint-url "$R2_ENDPOINT"
if [ "$(date -u -d '+6 hours' +%d)" = "01" ]; then        # 1st of the month in Asia/Dhaka
  aws s3 cp "hrm-$STAMP.dump.age" "s3://hrm-backups/monthly/" --endpoint-url "$R2_ENDPOINT"
fi
rm -f "hrm-$STAMP.dump"                                    # plaintext never leaves the runner
```

The aws CLI uses `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` mapped from the R2 backup token, with `AWS_DEFAULT_REGION=auto`. Expiry is handled by the R2 lifecycle rules (`ACCOUNT-SETUP.md` §2.3): `daily/` after 30 days, `monthly/` after 365 days.

The job ends by listing `daily/` and failing if the newest object is not today's. A failed run sends GitHub's failure email to the owner. `OBSERVABILITY.md` §6 adds a separate staleness alert.

The dump transfers the whole database out of Neon each night, which counts towards Neon's 5 GB/month public transfer allowance. At < 350 MB that's at most ≈ 10 GB/month in the worst case. **Check in `FREE-TIER-MONITORING.md`:** if the dump is larger than 150 MB, move to weekly dumps plus Neon's restore window, or reduce data (prune old outbox and session rows).

## 4. Restore procedures

Get the owner's approval before any production restore: restoring loses every change after the restore point.

### 4.1 Mistake in the last 6 hours (recommended first choice) 🔴

Use Neon instant restore: Neon console → project `hrm` → **Backup & Restore** (or Branches → `main` → Restore) → choose a timestamp before the mistake → restore. Neon keeps the pre-restore state as a backup branch, so the restore can be undone. Then:

1. Run the sanity queries (§4.3).
2. Redeploy is not needed (Hyperdrive points to the same branch endpoint). Check `/api/v1/health`.
3. Record the incident (`INCIDENT-RUNBOOKS.md` IR-09).

### 4.2 Older than 6 hours, or Neon project lost

```bash
# 1. 🟢 Find and download the backup
export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… AWS_DEFAULT_REGION=auto
aws s3 ls s3://hrm-backups/daily/ --endpoint-url "$R2_ENDPOINT"
aws s3 cp s3://hrm-backups/daily/hrm-2027-03-10T2100Z.dump.age . --endpoint-url "$R2_ENDPOINT"
aws s3 cp s3://hrm-backups/daily/hrm-2027-03-10T2100Z.dump.sha256 . --endpoint-url "$R2_ENDPOINT"

# 2. 🟢 Decrypt and verify
age -d -i hrm-backup.key -o hrm-2027-03-10T2100Z.dump hrm-2027-03-10T2100Z.dump.age
sha256sum -c hrm-2027-03-10T2100Z.dump.sha256

# 3. 🟠 Restore into a NEW Neon branch first (never straight into main)
#    Neon console → Branches → New branch "restore-2027-03-10" from main (or an empty branch)
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname "<owner direct string of restore branch>" hrm-2027-03-10T2100Z.dump

# 4. 🟢 Run the sanity queries (4.3) against the restore branch
```

5. 🔴 Switch production to the restored data. Either:
   - (recommended) In Neon, make the restore branch the default/primary branch, or restore `main` from it. Then update Hyperdrive if the host changed:
     `pnpm --filter @hrm/api exec wrangler hyperdrive update <prod-id> --connection-string="<hrm_app direct string of new branch>"`
   - Re-run grants for `hrm_app` if the role or grants were not in the dump: `pnpm --filter @hrm/db grants`.
6. 🟢 Smoke checks (`DEPLOYMENT.md` §5).
7. 🖐 Delete the plaintext `.dump` file: `shred -u hrm-*.dump`.

### 4.3 Sanity queries

```sql
SELECT count(*) FROM employees;                                     -- expected: known headcount
SELECT max(created_at) FROM audit_logs;                             -- close to the restore point
SELECT status, count(*) FROM payroll_runs GROUP BY status;          -- matches the last known state
SELECT employee_id, sum(amount) FROM leave_ledger_entries
  GROUP BY employee_id ORDER BY 2 LIMIT 5;                          -- balances look sane
```

Table names follow `docs/03-architecture/DATA-MODEL.md`; adjust if they differ.

## 5. Quarterly restore drill (NFR-OPS-003)

Run in the first week of January, April, July and October.

- **Option A (automated):** run `restore-drill.yml`. It downloads the latest dump, decrypts with `BACKUP_AGE_IDENTITY`, restores into a Postgres service container, runs §4.3, and reports row counts. Needs the private key in GitHub (§2).
- **Option B (manual, recommended for a private repository):** the owner runs §4.2 steps 1–4 on their laptop against a local Docker Postgres (`docker run --rm -e POSTGRES_PASSWORD=x -p 5433:5432 postgres:<major>`), instead of a Neon branch. Time the whole run.

Pass criteria: decryption works with the stored key, checksum matches, restore finishes without errors, sanity queries match production counts at backup time, and total time is well under the 4-hour RTO.

## 6. Drill log

| Date | Option | Backup file | Duration | Result | By |
|---|---|---|---|---|---|
| | | | | | |
