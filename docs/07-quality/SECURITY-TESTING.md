# Security testing

Status: **Accepted**, 2026-10-22. This doc says how the authorization model, authentication, uploads and dependencies are tested, and what the pre-release security review covers. The rules being tested are in `docs/03-architecture/SECURITY-MODEL.md`; the threats they answer are in `THREAT-MODEL.md`. All tools are free (D-032).

## 1. Test personas

Every API security test runs as these seeded personas. They're created by the test factory, not by hand.

| Persona | Roles | Notes |
|---|---|---|
| `anon` | none | No session cookie |
| `sysadmin` | `system_admin` | Strong session |
| `hr` | `hr_admin` + `employee` | Strong session |
| `payroll` | `payroll_officer` + `employee` | Strong session |
| `director` | `director` + `employee` | Strong session |
| `auditor` | `auditor` | Strong session, no employee link |
| `mgr` | `manager` (derived) + `employee` | Manages `emp1` directly and `emp1b` indirectly (`emp1b` reports to `emp1`) |
| `mgr2` | `manager` (derived) + `employee` | Peer manager; manages `emp2` only |
| `emp1`, `emp1b`, `emp2` | `employee` | Ordinary employees |
| `hr_weak` | `hr_admin` + `employee` | Signed in with email OTP only, no TOTP (weak session) |
| `suspended` | `employee`, `user_status = suspended` | Had a valid session before suspension |
| `unlinked` | none, user without an employee record | Valid session |

## 2. Expected status codes

| Situation | Status | `code` |
|---|---|---|
| No session | 401 | `UNAUTHENTICATED` |
| Privileged role on a weak session | 403 | `MFA_REQUIRED` |
| Missing permission for a collection or action | 403 | `FORBIDDEN` |
| Record exists but is outside the persona's scope | **404** | `NOT_FOUND` (same body as a missing record, SECURITY-MODEL §1.6) |
| Sensitive action without re-auth in the last 15 min | 403 | `REAUTH_REQUIRED` |
| Requester tries to approve own request | 403 | `SELF_APPROVAL_FORBIDDEN` |

The final error codes are defined in `docs/05-backend/API-STANDARDS.md`. If a name there differs, that file wins and this table is updated.

## 3. Permission × scope matrix

The matrix test is **generated** from the permission catalogue, not written by hand per endpoint:

1. `packages/contracts` exports `PERMISSIONS` and `ROLE_GRANTS` (the seed matrix from `SECURITY-MODEL.md` §4).
2. Each route declares its required permission and scope in its OpenAPI metadata (`x-permission`, `x-scope`).
3. `apps/api/test/security/matrix.test.ts` loops over every route × every persona in §1, calculates the expected result from `ROLE_GRANTS` and the persona's relationship to the target record, and asserts the status code from §2.
4. A CI check fails if a route has no `x-permission` (no unprotected route can be added by accident) or if a permission in the catalogue is used by no route.

Endpoint groups and their gate (the authoritative list is `docs/05-backend/API-CATALOGUE.md`):

| Endpoint group | Permission(s) | Scope rule tested |
|---|---|---|
| `GET/POST /employees`, `PATCH /employees/{id}` | `employee.read.{all,team,own}`, `employee.manage` | `mgr` sees `emp1`, `emp1b`, not `emp2`; `emp1` sees only self |
| `GET /employees/{id}` contact block | `employee.contact.read.all` | `payroll`, `director` get the employee without contact fields |
| `/salary-structures` | `compensation.read.{all,own}`, `compensation.manage` | `hr` can read, cannot write; `emp1` reads own only; `sysadmin` gets 403 |
| `/payroll/runs/*` actions | `payroll.prepare`, `payroll.approve`, `payroll.lock`, `payroll.pay` | `director` can approve but not prepare or lock |
| `/payroll/payslips/me`, `/payroll/payslips/{id}` | `payslip.read.{own,all}` | `emp1` gets 404 for `emp2`'s payslip |
| `/attendance/check-in`, `/check-out` | `attendance.check_in.own` | Body field `employeeId` is ignored; the event is always for the session's employee (FR-ATT-012) |
| `/attendance`, `/attendance/summary` | `attendance.read.{all,team,own}` | `mgr2` gets no `emp1` rows |
| `/attendance/corrections/{id}/approve` | `attendance.correction.review.{team,all}` | `mgr2` gets 404 for `emp1`'s correction; `emp1` cannot approve own |
| `/leave/requests/{id}/approve` | `leave.request.review.{team,all}` | `mgr` approves `emp1`; `hr` approves when no manager |
| `/leave/policies`, `/leave/types` writes | `leave.policy.manage` | Only `hr` |
| `/reimbursements/*` | `reimbursement.request.own`, `reimbursement.review.{team,all}`, `reimbursement.read.all` | Same pattern as leave |
| `/documents/{id}/download` | `document.read.{own,all}`, `document.payroll.read` | Restricted categories need `all`; payroll category for `payroll`; download is audited |
| `/approvals/inbox` | `approval.inbox` | Each approver sees only items assigned to them |
| `/reports/*` and their exports | `report.{hr,payroll,team}` | Export returns the same rows as the view for each persona (FR-REP-006) |
| `/audit-logs` | `audit.read.{all,payroll,technical}` | `payroll` sees only payroll entries; `sysadmin` only technical ones |
| `/settings` | `settings.read`, `settings.{technical,hr,payroll}.manage` | `sysadmin` cannot change payroll settings |
| `/users`, `/roles` | `user.manage`, `role.manage` | `hr` invites but cannot assign roles; nobody can assign `manager` or `employee` by hand |
| `/health/details` | `system.health.read` | Only `sysadmin` |

**IDOR checks for every `{id}` route:** use real IDs of another employee's records (UUID v7, valid format); try the same request with the id in the path, the query string and the JSON body; assert 404 and that no audit "read" row is written for the target.

**Privilege escalation checks:**
- `emp1` sends `PATCH /employees/{self}` with `roles`, `status`, `managerId`, `salary` fields → the fields are ignored or 422; nothing changes.
- `hr` assigns themselves `payroll_officer` → 403 (`role.manage` missing).
- `sysadmin` grants themselves `compensation.read.all` → allowed only through `role.manage`, and audited. The test asserts the audit row exists.
- `mgr` changes `emp1`'s manager to themselves via a profile change → only `hr` can approve.
- `suspended`'s old cookie → 401 on the next request (sessions revoked at suspension, FR-AUTH-006).

## 4. Authentication tests

| ID | Test | Expected |
|---|---|---|
| AUTH-01 | Request OTP for an unknown email | Same 200 response and similar timing as for a known email (no account enumeration); no email sent |
| AUTH-02 | 6 OTP send requests for one email within 15 min | 6th returns 429 `RATE_LIMITED` |
| AUTH-03 | Wrong OTP 5 times | Code invalidated; new code required; attempt events audited |
| AUTH-04 | OTP reused after successful sign-in | 401 |
| AUTH-05 | OTP used after expiry (clock + expiry window) | 401 |
| AUTH-06 | Sign-out | Session row deleted; old cookie gets 401 (FR-AUTH-003) |
| AUTH-07 | Suspend or deactivate a user | All sessions revoked immediately; new sign-in refused (FR-AUTH-006) |
| AUTH-08 | `hr_weak` calls a privileged route | 403 `MFA_REQUIRED`; after TOTP step-up, 200 |
| AUTH-09 | Sensitive action (role change, payroll lock, payment recording) with a session older than 15 min since last auth | 403 `REAUTH_REQUIRED` |
| AUTH-10 | Invitation link used twice, or after expiry | 410 / 401; no second account |
| AUTH-11 | Public sign-up endpoint | Does not exist (404) |
| AUTH-12 | Session cookie attributes | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`; no session token in any response body or URL |
| AUTH-13 | Idle and absolute timeouts (8 h / 7 days; privileged 1 h idle) | Expired session gets 401 (with fake timers) |
| AUTH-14 | Passkey registered on one account used to sign in to another | Refused |
| AUTH-15 | TOTP recovery code used twice | Second use refused |

## 5. Web and API attack tests

| ID | Area | Test | Expected |
|---|---|---|---|
| WEB-01 | CSRF | `POST` with a foreign `Origin` header | 403 (origin check on every state-changing request) |
| WEB-02 | CSRF | `POST` with no `Origin` and no `Referer` | 403 |
| WEB-03 | CORS | Preflight from a foreign origin | No `Access-Control-Allow-Origin` header (API is same-origin only) |
| WEB-04 | Headers | Any HTML response | `Content-Security-Policy` (no `unsafe-inline` scripts), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security`, `frame-ancestors 'none'` |
| WEB-05 | XSS | Store `<img src=x onerror=alert(1)>` in an employee name, leave reason and claim description; view in every list, detail page, email template and PDF | Rendered as text everywhere |
| WEB-06 | SQL injection | Filter/sort parameters with `' OR 1=1--`, `;DROP`, unknown sort fields | 422 for invalid values; sort uses an allow-list; Drizzle parameterises everything |
| WEB-07 | Mass assignment | Extra fields in every create/update body | Rejected by the strict Zod schema (422) |
| WEB-08 | Pagination abuse | `limit=100000` | Clamped to the documented max |
| WEB-09 | Error leakage | Force a 500 | problem+json with request id only; no stack trace, SQL or env values |
| WEB-10 | CSV injection | Name starting with `=`, `+`, `-`, `@` exported to CSV/XLSX | Cell is prefixed so it isn't executed as a formula |

## 6. Upload tests (FR-DOC-004, NFR-SEC-008)

| ID | Upload | Expected |
|---|---|---|
| UP-01 | 10 MB + 1 byte | 413 |
| UP-02 | `.exe` renamed to `.pdf` (magic bytes mismatch) | 415 |
| UP-03 | SVG with a `<script>` tag | 415 (SVG not on the allow-list) |
| UP-04 | HTML file declared as `image/png` | 415 |
| UP-05 | File name `../../etc/passwd` or with control characters | Stored under a generated R2 key; original name sanitised for `Content-Disposition` |
| UP-06 | Zip bomb / polyglot PDF | Rejected by type allow-list (no archives); PDFs are served only as `attachment` |
| UP-07 | Download response headers | `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, correct `Content-Type` |
| UP-08 | Guess another employee's R2 key in a URL | No public bucket URL exists; API returns 404 |

There's no free in-Worker malware scanner. Magic-byte checks and the type allow-list are the v1 control (`THREAT-MODEL.md`, residual risk R-04).

## 7. Audit integrity

| ID | Test | Expected |
|---|---|---|
| AUD-01 | Any API route that updates or deletes `audit_logs` | None exists (route catalogue check) |
| AUD-02 | App DB role runs `UPDATE audit_logs …` or `DELETE FROM audit_logs …` | Permission denied (DB grants) |
| AUD-03 | Audit metadata for sign-in, OTP and document access | Contains no OTP, token, full national ID number or file content (FR-AUD-004) |
| AUD-04 | Each sensitive action in FR-AUD-002 | Produces exactly one audit row with actor, action, entity, timestamp |

## 8. Dependency and secret scanning (CI)

| Check | Tool (free) | When | Fails the build on |
|---|---|---|---|
| Known vulnerable packages | `pnpm audit --prod --audit-level=high` | Every PR, nightly | High or critical in production deps |
| Vulnerability database cross-check | `osv-scanner` on `pnpm-lock.yaml` | Every PR, nightly | Any finding with a fix available |
| Static analysis | **Semgrep OSS** (`semgrep --metrics=off --config p/default --config p/typescript --config p/secrets`); never Semgrep Pro or the AppSec Platform | Every PR | ERROR-severity findings |
| Secrets in code | `gitleaks` (CLI, run directly; not the paid GitHub Action licence) | Every PR and pre-commit | Any finding |
| GitHub Actions hardening | Review with the `gha-security-review` skill | Every change under `.github/workflows/` | Reviewer sign-off |
| Supply-chain risk of new deps | `supply-chain-risk-auditor` skill | Any PR that adds a dependency | Reviewer sign-off |

Dependabot (free) opens weekly update PRs for npm and GitHub Actions.

## 9. Pre-release security review

Before each production release that changes auth, permissions, payroll, documents or workflows:

1. Run the `differential-review` skill on the release diff (`git diff <last-release-tag>..HEAD`).
2. Run the `security-review` skill on changed modules.
3. Run the `sharp-edges` skill on new public APIs or configuration.
4. Confirm §3 matrix tests and §4–§7 suites are green on the release commit.
5. Record findings and their resolution in the release PR. Open high-severity findings block the release.

Before go-live, the full review covers the whole codebase, not a diff (`docs/08-operations/GO-LIVE-CHECKLIST.md`).
