# Go-live checklist

Status: **Template.** Copy into the release PR for v1.0.0 and tick items with evidence links. Production use starts only when every item is ticked or explicitly waived in writing by the owner (SRS §12 Phase 5 exit gate).

## 1. SRS §11.2 acceptance criteria

| # | Criterion | Evidence | ☐ |
|---|---|---|---|
| 1 | HR can create, update and archive employee records while linked history is preserved | E2E-03 green; service tests for archive with history | ☐ |
| 2 | A user cannot access another employee's private data by changing an identifier | `docs/07-quality/SECURITY-TESTING.md` §3 matrix green; E2E-09 | ☐ |
| 3 | Attendance events and corrections remain traceable | E2E-05; original events visible after correction | ☐ |
| 4 | Leave approval and ledger posting are atomic and give correct balances | Concurrency tests; property tests (TESTING-STRATEGY §6); E2E-06 | ☐ |
| 5 | Salary calculations use decimal arithmetic and keep effective-dated inputs | PAY-01…PAY-13 green, including PAY-12c | ☐ |
| 6 | Payroll can't be published before validation and approval | PAY-13; state machine tests | ☐ |
| 7 | Locked payroll can't be silently modified | PAY-10 | ☐ |
| 8 | Payslips and documents only reach authorised users | Matrix rows for payslips/documents; UP-08 | ☐ |
| 9 | Reports and exports enforce permissions | Matrix rows for `/reports/*` exports (FR-REP-006) | ☐ |
| 10 | Sensitive changes are in the audit log | AUD-01…AUD-04 | ☐ |
| 11 | Payroll compared with independent calculations and approved by the company | `docs/07-quality/PAYROLL-TEST-CASES.md` §15 fully signed | ☐ |
| 12 | A backup has been restored successfully in a test environment | `BACKUP-AND-RESTORE.md` §6 drill log entry | ☐ |
| 13 | Production configuration has no committed secrets | gitleaks clean on the release commit; `SECRETS.md` review | ☐ |
| 14 | Core workflows pass automated tests on supported browsers | Nightly full E2E (Chromium, Firefox, WebKit, mobile) green on the release commit | ☐ |

## 2. Owner decisions that must be on record

| Item | Where recorded | ☐ |
|---|---|---|
| Payroll sign-off items S-01 to S-04 (day counting, mid-period salary change, split payments, anomaly threshold) | `PAYROLL-TEST-CASES.md` §15 | ☐ |
| Accepted compliance risk: TDS and maternity leave outside the system (D-023), confirmed with a qualified local adviser (NFR-LOC-005) | Decision log | ☐ |
| Document retention periods per category (X-003, SRS §14.9) | Settings + decision log | ☐ |
| R2 documents not backed up in v1 (`BACKUP-AND-RESTORE.md` §1): accept or require a fix | Decision log | ☐ |
| Repository public or private, and the matching deploy controls (`ACCOUNT-SETUP.md` §7.2) | Decision log | ☐ |
| Production URL (Worker name) fixed before first deploy (`ENVIRONMENTS.md` §1) | Decision log | ☐ |
| Cron schedule and Neon compute approach (`ENVIRONMENTS.md` §4) | Decision log | ☐ |

| Every v1 story in `docs/00-requirements/USER-STORIES.md` accepted; open risks in `docs/00-requirements/RISK-REGISTER.md` reviewed by the owner | Story status; risk register | ☐ |

## 3. Security readiness

| Item | ☐ |
|---|---|
| Full-codebase security review with `security-review`, `sharp-edges` and `differential-review` skills; no open high findings (`SECURITY-TESTING.md` §9) | ☐ |
| `docs/07-quality/THREAT-MODEL.md` reviewed against the built system | ☐ |
| `pnpm audit`, OSV, Semgrep OSS and gitleaks clean on the release commit | ☐ |
| 2FA on every operator account; two owners per account (`ACCOUNT-SETUP.md` §9 filled in) | ☐ |
| Gmail OAuth app *In production*; refresh token works; recovery options set | ☐ |
| R2 buckets private; no `r2.dev` URL | ☐ |
| `hrm_app` DB role has no UPDATE/DELETE on `audit_logs` (AUD-02 run against production) | ☐ |
| First `system_admin` has TOTP and recovery codes stored offline | ☐ |

## 4. Operations readiness

| Item | ☐ |
|---|---|
| Staging and production created per `ACCOUNT-SETUP.md`; IDs in `wrangler.jsonc` | ☐ |
| Nightly backup ran successfully at least 3 nights in a row | ☐ |
| Restore drill done (criterion 12) | ☐ |
| Sentry alerts AL-01…AL-07 tested by triggering a test error in staging | ☐ |
| Health details page shows all jobs succeeding | ☐ |
| Free-tier baseline recorded (`FREE-TIER-MONITORING.md` §6, first row) | ☐ |
| Performance budgets PB-01…PB-10 met on staging (`docs/07-quality/PERFORMANCE-BUDGETS.md`) | ☐ |
| Rollback rehearsed on staging (`DEPLOYMENT.md` §6.1) | ☐ |
| Incident runbooks read by the owner and the backup operator | ☐ |

## 5. Data and people

| Item | ☐ |
|---|---|
| Employee data imported and checked by HR (SRS Phase 5 data migration); import error report empty | ☐ |
| Opening leave balances entered as `adjustment` ledger entries with reason "opening balance", checked by HR | ☐ |
| Salary structures entered and checked against the payroll officer's records | ☐ |
| A parallel payroll run (old method and HRM side by side) for at least one month matches to the poisha | ☐ |
| HR, payroll, managers and employees trained (user guides in `docs/10-user-guides/`) | ☐ |
| Users invited; privileged users enrolled TOTP or passkeys | ☐ |
| Stakeholder sign-off (owner, HR, finance) | ☐ |

## 6. Sign-off

| Role | Name | Date | Signature / approval link |
|---|---|---|---|
| Owner | | | |
| HR | | | |
| Finance / payroll | | | |
| Technical lead | | | |

## Added by the Stage 7 auth spike

| Check | Evidence | Done |
|---|---|---|
| Workers Logs on staging show `cpuTime` under 10 ms (p95) for `/auth/sign-in/email-otp`, `/auth/two-factor/verify-totp` and passkey sign-in, with no 1102 errors | `docs/05-backend/AUTH-SPIKE.md` conclusions 2–3 | ☐ |
