# Incident runbooks

Status: **Draft.** No incident has been handled yet. After each real incident, correct the matching entry with what actually happened and add a postmortem under `docs/08-operations/postmortems/`.

Troubleshooting entries are symptom-first: find the symptom, run the cheapest checks first. This document does not cover routine deploys (`DEPLOYMENT.md`) or backups (`BACKUP-AND-RESTORE.md`) except where an incident needs them.

**Legend:** 🟢 safe, read-only · 🔴 changes production · 🖐 manual step in a dashboard

## Before anything: triage (2 minutes)

```bash
BASE=https://hrm.<account-subdomain>.workers.dev
curl -sS -w '\nHTTP %{http_code} in %{time_total}s\n' "$BASE/api/v1/health"         # 🟢
pnpm --filter @hrm/api exec wrangler tail hrm --format pretty                     # 🟢 live requests, Ctrl-C to stop
```

Then check the provider status pages: https://www.cloudflarestatus.com, https://neonstatus.com, https://www.google.com/appsstatus.

Tell users in the company chat within 15 minutes if the app is down or payroll is affected. Write down the time of every action; it goes into the postmortem.

## IR-01: Site down or most requests fail

**Symptom:** the browser shows a Cloudflare error page, `/api/v1/health` returns 5xx or `"db":"degraded"`, Sentry alert AL-01.

**Checks, cheapest first:**
1. 🟢 Provider status pages (above). If Cloudflare or Neon has an incident, wait and inform users; nothing to fix locally.
2. 🟢 `wrangler tail`: look at the `outcome` of failing requests.
   - `exceededCpu` → IR-02.
   - `exception` → read the stack in Sentry `hrm-api`.
   - `ok` but status 503 with `db: degraded` → IR-03.
   - `daily request limit` / error 1027 → Workers free daily request limit reached; it resets at 00:00 UTC. Look for a client loop or bot in logs (`FREE-TIER-MONITORING.md` §4).
3. 🟢 Did a deploy just happen? `wrangler deployments list --env production`.

**Fix:**
- Bad deploy: 🔴 roll back (`DEPLOYMENT.md` §6.1).
- Code bug without a deploy: fix forward through the normal release; meanwhile inform users.

## IR-02: Error 1102 "Worker exceeded resource limits"

**Symptom:** some requests fail with `Error 1102`; `wrangler tail` shows `outcome: exceededCpu`.

**Cause:** the request used more than 10 ms of CPU (Workers Free, ADR-0009).

**Fix:**
1. 🟢 Find the route: `wrangler tail hrm --status error --format json | grep exceededCpu`.
2. If a recent deploy introduced it, 🔴 roll back (`DEPLOYMENT.md` §6.1).
3. Otherwise, reduce the work for that route (`docs/07-quality/PERFORMANCE-BUDGETS.md` §2): move aggregation to SQL, paginate, batch. Common culprits: large list without pagination, big Zod array parse, report computed in JavaScript.
4. If it's a cron job, lower its batch size; the next run picks up the rest.

## IR-03: Database unreachable or Neon compute suspended

**Symptom:** `/api/v1/health` shows `"db":"degraded"`; Sentry shows connection errors or Neon messages about compute quota.

**Checks:**
1. 🟢 Neon console → project `hrm` → **Usage**: are the monthly compute hours used up? Neon suspends compute until the next billing cycle when a Free limit is reached.
2. 🟢 Neon console → Branches → `main` → compute state (Active / Idle / Suspended) and Monitoring.
3. 🟢 Neon status page.
4. 🟢 Hyperdrive config still points to the right host: `wrangler hyperdrive get <prod-id>`.

**Fix:**
- **Compute quota exhausted:** there's no free fix inside the month. Options, owner decides: (a) wait until the next month and run payroll and leave manually on paper meanwhile; (b) temporarily upgrade Neon (costs money, reverses D-032). Afterwards find what kept the database awake (`FREE-TIER-MONITORING.md` §4) and fix it before the next month.
- **Storage limit (writes fail, reads work):** run `maintenance.prune` by hand, then review data growth.
- **Neon incident:** wait; inform users.
- **Password rotated without updating Hyperdrive:** 🔴 `wrangler hyperdrive update <prod-id> --connection-string="…"` (`SECRETS.md` §2).

## IR-04: Emails not arriving (sign-in codes, approvals)

**Symptom:** users don't receive sign-in codes; Sentry alert AL-07 (outbox dead letters); outbox rows in `failed`/`dead`.

**Checks:**
1. 🟢 Health details page: dead outbox count and the last error message.
2. 🟢 Error text:
   - `invalid_grant` / `Token has been expired or revoked` → the Gmail refresh token is invalid. Causes: the OAuth app was left in *Testing* (tokens expire after 7 days), the dedicated account's password was changed, or access was revoked.
   - `429` / `Daily user sending limit exceeded` → Gmail daily cap reached; resets within 24 hours.
   - `403 insufficientPermissions` → wrong scope; must be `gmail.send`.
3. 🟢 Sign in to the dedicated Gmail account: any security warning or lock?

**Fix:**
- Token invalid: 🖐 confirm the OAuth app is *In production* (`ACCOUNT-SETUP.md` §5.2 step 6), get a new refresh token (§5.3), then 🔴 `wrangler secret put GMAIL_REFRESH_TOKEN --env production`. Then requeue dead messages from the health page ("Retry dead messages"), or with SQL: `UPDATE outbox_messages SET status='pending', attempts=0 WHERE status='dead';`.
- Daily cap: wait. Meanwhile users with a passkey can still sign in. For an urgent sign-in, a `system_admin` can create a one-time sign-in link from the admin page (audited), if implemented (`docs/05-backend/AUTH-IMPLEMENTATION.md`).
- Account locked by Google: follow Google's recovery with the recovery phone/email of the two owners (THREAT-MODEL T-16).

## IR-05: File upload or download fails

**Symptom:** uploads return 5xx; downloads fail; Sentry shows R2 errors.

**Checks:**
1. 🟢 Cloudflare status (R2 component).
2. 🟢 Dashboard → R2 → `hrm-prod-files` exists, binding name `FILES` matches `wrangler.jsonc`.
3. 🟢 R2 usage still inside the free allowance (`FREE-TIER-MONITORING.md` §1). Over the allowance R2 keeps working but **bills the card**.
4. 🟢 The error is 413/415 for one user → validation, not an incident (file too big or wrong type).

**Fix:** binding mismatch → fix config and redeploy. R2 incident → wait.

## IR-06: Scheduled jobs not running

**Symptom:** health details show a job overdue (AL-08); outbox retries don't happen; leave accrual missing on the 1st.

**Checks:**
1. 🟢 Dashboard → Workers → `hrm` → **Settings → Triggers**: are the Cron Triggers listed (`ENVIRONMENTS.md` §4)? A deploy with an empty `triggers.crons` removes them.
2. 🟢 Workers → Metrics, filter by cron: are invocations happening, and with what outcome?
3. 🟢 `job_runs` table: last `failed` row and `error_summary`.

**Fix:**
- Triggers missing: restore `triggers.crons` in `wrangler.jsonc` and redeploy.
- Job failing: fix the bug; jobs are idempotent (`ARCHITECTURE.md` §4), so after the fix run the job by hand from the admin health page ("Run now"), or wait for the next schedule.
- Missed monthly accrual: run `leave.accrue` for the missed month; it skips entries already posted.

## IR-07: Wrong payroll was approved or locked

**Symptom:** after locking (or paying), someone finds a wrong amount.

**Rules:** a locked run is never edited or unlocked (FR-PAY-011, `DOMAIN-MODEL.md` §5.6). Never change payroll rows with SQL.

**Fix:**
1. 🖐 The payroll officer records the problem: affected employees, wrong vs correct amount, and how it was found.
2. If payments were **not yet made**, mark the affected payments as not paid and hold them. Create `PayrollAdjustment`s (addition or deduction) for the next run, or an `off_cycle` run if the owner wants it paid sooner.
3. If payments **were made**, use an adjustment in the next run (`docs/07-quality/PAYROLL-TEST-CASES.md` PAY-10). Inform affected employees in writing.
4. If the cause is a calculation bug: stop further payroll runs, add a failing test case to `PAYROLL-TEST-CASES.md`, fix, and get the owner's sign-off on the new expected values before the next run.

## IR-08: Suspected account compromise or leaked secret

**Symptom:** AL-06 brute-force alert; a user reports a sign-in they didn't make; a secret shows up in a commit, log, chat or screenshot.

**Contain first (minutes matter):**
1. 🔴 Suspend the affected user account (admin → Users → Suspend). This revokes all their sessions immediately (FR-AUTH-006).
2. If a privileged account: also remove their privileged roles until the review is done (audited).
3. Leaked secret: rotate it **now** (`SECRETS.md` §2–§3), then remove it from wherever it leaked. Rotating `BETTER_AUTH_SECRET` signs everyone out (see `SECRETS.md` before doing it). If it was committed, rotating is mandatory; rewriting git history alone isn't enough.
4. Repeated failed OTPs from one IP: Cloudflare dashboard → Security → WAF custom rule to block that IP (custom rules are available on the free plan; verify the count).

**Investigate:** audit log filtered by the user and time window (FR-AUD-005): what did they view or change? Document downloads are audited (FR-DOC-007).

**Recover:** remove and re-register passkeys and TOTP for the user; reactivate; tell the user what happened. If personal or salary data was accessed by someone unauthorised, the owner decides on notifying affected employees.

## IR-09: Data was deleted or corrupted

**Symptom:** records missing or wrong after a bug, bad migration or mistaken bulk action.

**Fix:**
1. 🖐 Stop the cause: roll back the deploy (`DEPLOYMENT.md` §6.1) or suspend the user.
2. 🟢 Find when it happened (audit log, deploy time).
3. Less than 6 hours ago: Neon instant restore to just before that time (`BACKUP-AND-RESTORE.md` §4.1). Owner approval first.
4. More than 6 hours ago: restore the nightly backup to a **new branch** and copy back only the affected rows, or restore fully if the damage is wide (`BACKUP-AND-RESTORE.md` §4.2). Owner approval first.
5. Re-enter changes made after the restore point from the audit log where needed.

## After every incident

1. Write a short postmortem (what happened, timeline, impact, cause, fixes) within 3 working days, using the `writing-postmortems` structure. Blameless.
2. Add or correct the matching entry in this file.
3. Add a regression test if a code bug was involved.
