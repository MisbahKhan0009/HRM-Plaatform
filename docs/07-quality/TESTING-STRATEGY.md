# Testing strategy

Status: **Accepted**, 2026-10-22. This doc says what to test, where, with which tool, and when a change is not done without tests. It does not cover the payroll cases themselves (`PAYROLL-TEST-CASES.md`), the security matrix (`SECURITY-TESTING.md`) or performance budgets (`PERFORMANCE-BUDGETS.md`).

Every tool listed is free and open source (D-032). Sources: SRS §11, ADR-0008, `docs/03-architecture/{ARCHITECTURE,DOMAIN-MODEL,SECURITY-MODEL,MONOREPO}.md`.

## 1. Tools

| Tool | Version policy | Used for |
|---|---|---|
| Vitest | pinned in `packages/config` | Unit and integration tests in every package |
| `@cloudflare/vitest-plugin` | pinned | API tests that run inside the Workers runtime (`workerd`), with real bindings (R2 via Miniflare, Hyperdrive pointed at a test Postgres) |
| Testing Library (`@testing-library/react`, `user-event`) | pinned | React component and feature tests in `apps/web` and `packages/ui` |
| fast-check | pinned | Property-based tests for money, dates, leave and payroll rules (`packages/domain`) |
| Playwright | pinned; uses the Chromium, Firefox and WebKit builds Playwright ships | End-to-end tests in `e2e/` |
| `@axe-core/playwright` | pinned | Accessibility checks in E2E (WCAG 2.2 AA target, NFR-UX-004) |
| PostgreSQL (Docker image matching Neon's major version) | same major as Neon `main` | DB-backed tests locally and as a GitHub Actions service container |

Neon branches are **not** used for CI. Each CI run gets a throwaway Postgres service container instead, which saves Neon compute-hours and branch slots (ADR-0009).

## 2. Test pyramid by layer

| Layer / package | Test type | Runs against | Owner rule |
|---|---|---|---|
| `packages/contracts` | Unit: schema accepts valid and rejects invalid payloads; money strings, ISO dates | nothing (pure) | Every new schema has at least one accept and one reject case |
| `packages/domain` | Unit + property-based | nothing (pure) | Coverage gate in §5. Every rule in `docs/05-backend/BUSINESS-RULES.md` has a test that names the rule ID |
| `packages/db` | Migration tests: migrate up from empty, constraint tests (unique, FK `RESTRICT`, check constraints) | Postgres container | Every migration runs in CI from zero |
| `apps/api` `*.repository.ts` | Integration | Postgres container | Queries that filter by scope get a test with records outside the scope |
| `apps/api` `*.policy.ts` | Unit, table-driven | nothing | One row per permission × scope from `SECURITY-MODEL.md` §4 |
| `apps/api` `*.service.ts` | Integration: transaction, audit row, outbox row, state transitions, idempotency | Postgres container | Every allowed and every rejected transition in `DOMAIN-MODEL.md` §5 |
| `apps/api` `*.routes.ts` | API tests through `SELF.fetch` in `vitest-plugin` | Worker runtime + Postgres | Status codes, problem+json body, auth required, DTO shape per role |
| `apps/api` OpenAPI | Contract test: generated spec matches the routes and validates sample responses | Worker runtime | Runs on every PR (SRS §8.7) |
| `apps/api/src/jobs` | Integration: run twice and assert the same end state (idempotent) | Postgres container | Every job |
| `packages/ui` | Component tests: states (default, hover, focus, disabled, error), keyboard behaviour, both themes | jsdom | Every exported component |
| `apps/web` features | Component/feature tests with mocked API (MSW) | jsdom | Forms: field errors next to fields, submit error, loading, empty state (SRS §4.1) |
| `packages/documents` | Unit: payslip PDF built from a fixed snapshot gives stable text content; CSV/XLSX columns and escaping | jsdom / node | Snapshot of extracted text, not of bytes |
| `e2e/` | Playwright, critical journeys only (§4) | Built app + seeded Postgres | Must stay under 10 minutes in CI |

Target proportions by count: about 70% unit/property, 25% integration/API, 5% E2E.

## 3. What is mandatory per change type

A change is not done until the tests in its row exist and pass in CI. `docs/09-process/DEFINITION-OF-DONE.md` links here.

| Change | Required tests |
|---|---|
| New or changed business rule (`packages/domain`) | Unit tests with hand-computed expected values, plus a property test when the rule involves arithmetic, dates or balances |
| New endpoint | API test for: happy path, validation error (422), unauthenticated (401), each role in the permission matrix (`SECURITY-TESTING.md` §3), out-of-scope record (404), and the OpenAPI contract |
| New state transition | Service test for the allowed transition, at least one rejected transition (409), the audit row, and the outbox row if it sends email |
| Money or ledger effect | Idempotency test (same `Idempotency-Key` twice gives one effect), concurrency test (two parallel requests give a valid end state) |
| Migration | Up-migration from empty in CI; for data migrations, a test that runs it on seeded data and checks the result |
| UI form or page | Feature test for field-level errors, submit failure, loading and empty states; axe check in the E2E journey that visits it |
| Bug fix | A regression test that fails before the fix |
| Payroll calculation change | All cases in `PAYROLL-TEST-CASES.md` stay green; new cases need owner/finance sign-off on expected values |

## 4. End-to-end journeys (Playwright)

Run on Chromium on every PR to `main`. Run all three engines (Chromium, Firefox, WebKit) and the mobile viewport projects (Pixel 7, iPhone 14) nightly and before each release (SRS §11.2 item 14).

| ID | Journey | Roles |
|---|---|---|
| E2E-01 | Sign in with email OTP; register a passkey; sign out; session is invalid afterwards | employee |
| E2E-02 | Privileged user signs in with email OTP and is forced through TOTP step-up | hr_admin |
| E2E-03 | HR creates an employee (draft), assigns department, position, manager and schedule, invites a user, and the employee accepts | hr_admin, employee |
| E2E-04 | Employee checks in and out; attendance summary shows `present` | employee |
| E2E-05 | Employee requests an attendance correction; manager approves; the original event is still visible | employee, manager |
| E2E-06 | Employee requests leave; balance shows reservation; manager approves; balance shows usage; employee requests cancellation; manager approves; balance is restored | employee, manager |
| E2E-07 | Employee submits a transport claim with a receipt; manager approves; claim appears in the next payroll run (FR-REIM-001…003) | employee, manager, payroll_officer |
| E2E-08 | Payroll: create run, calculate, validate, submit, approve (self-approval with justification), lock, record payments, publish payslips; employee downloads their payslip PDF | payroll_officer, employee |
| E2E-09 | Employee B cannot open employee A's payslip, leave request or document by editing the URL (gets the not-found page) | employee |
| E2E-10 | Theme toggle: Ink by default, switch to Paper, preference survives reload and a new session | employee |
| E2E-11 | Mobile viewport: check-in, leave request and payslip download work at 360 × 800 | employee |

Auth in E2E: a Playwright `globalSetup` creates sessions per role through a **test-only** endpoint that exists only when `APP_ENV=test` and is excluded from the production bundle by a build flag. A CI check fails if the string `__test_login` appears in the production Worker bundle. Real OTP emails are never sent in tests: the `Mailer` is replaced with an in-memory adapter that tests can read.

Each journey runs `axe` on every page it visits and fails on any `serious` or `critical` violation.

## 5. Coverage gates

Coverage is measured with Vitest's `v8` provider and enforced in CI per package:

| Package | Lines | Branches |
|---|---|---|
| `packages/domain` (payroll, leave, attendance rules) | ≥ 95% | ≥ 95% |
| `packages/contracts` | ≥ 90% | ≥ 85% |
| `apps/api` services and policies | ≥ 85% | ≥ 80% |
| `apps/web`, `packages/ui` | ≥ 70% | ≥ 60% |

A coverage number is a floor, not the goal. Review checks that tests assert the hand-computed values, not just that the code ran.

## 6. Property-based tests (fast-check)

Required properties, at minimum:

| Area | Property |
|---|---|
| Money | `sum(roundHalfUp(lines))` equals the stored total; no JS `number` crosses the money boundary (inputs are generated as strings) |
| Proration | For any gross ≥ 0 and 1 ≤ days ≤ daysInMonth: 0 ≤ prorated ≤ gross; days = daysInMonth gives exactly gross |
| Split-period proration | Two adjacent segments covering the whole month at the same gross give gross ± 0.01 |
| Leave ledger | For any valid sequence of request/approve/reject/withdraw/cancel events, the balance equals the sum of ledger entries, and never goes below 0 unless a policy exception is recorded |
| Leave days | The day count for a range equals the count of working, non-holiday days in that range; half day is 0.5 |
| Work date | For any instant, the work date equals the `Asia/Dhaka` calendar date |
| State machines | Random transition sequences never reach a state outside `DOMAIN-MODEL.md` §5; rejected transitions leave the record unchanged |

Seeds are logged on failure. A failing seed becomes a fixed example test.

## 7. Database in tests

- **Locally:** `docker compose up db` starts Postgres; `pnpm db:migrate` applies migrations; tests use database `hrm_test`.
- **In CI:** a `postgres` service container per job (`.github/workflows/ci.yml`, see `docs/08-operations/CI-CD.md`).
- **Isolation:** each test file runs in its own schema (`test_<random>`), which is created by migrating and dropped afterwards. Tests inside a file use a transaction rolled back after each test, except tests that exercise transactions or concurrency themselves. Those get a fresh schema.
- **Concurrency tests** open two real connections and run the operations in parallel (for example two approvals of leave requests that together exceed the balance) and assert that exactly one succeeds (FR-LEAVE-013, FR-PAY-019).

## 8. Fixtures, factories and test data

- Factories live in `packages/db/test/factories` (`makeEmployee()`, `makeSalaryStructure()`, `makePayrollRun()` …). Each factory returns valid defaults and accepts overrides.
- The **seed** for local and staging (`pnpm db:seed`) creates one company, 3 departments, about 25 synthetic employees covering every role and status, a schedule (Sun–Thu, D-005), holidays for the current year, leave types from D-013 and salary structures.
- **Synthetic data only.** Names come from a fixed list of fictional names; national ID numbers use an invalid format prefix (`TEST-`); emails use `@example.test`. Production data never enters dev, CI or staging unless it has been through `scripts/anonymise` (NFR-SEC-009).
- Payroll expected values are written by hand in the test, never computed by calling the code under test (SRS §11.3).

## 9. Flaky-test policy

1. A test that fails, then passes on re-run without a code change, is flaky.
2. The person who sees it opens an issue labelled `flaky` with the CI link the same day.
3. The test is fixed or rewritten within 3 working days. Tests are never skipped, disabled or quarantined to get a green build.
4. E2E tests use web-first assertions (`await expect(locator).toHave…`) and never `waitForTimeout`. Time-dependent tests fix the clock (`page.clock`, `vi.useFakeTimers`) and the timezone (`TZ=UTC` for the process, `Asia/Dhaka` in assertions).

## 10. Mapping to SRS §11

| SRS §11.1 layer | Where it is covered |
|---|---|
| Unit tests for leave, attendance and payroll calculations | `packages/domain` (§2, §5, §6) |
| API tests for authentication, permissions, validation and state transitions | `apps/api` route and service tests (§2, §3), `SECURITY-TESTING.md` |
| Integration tests across attendance, leave, payroll, notifications and documents | `apps/api` service tests with outbox assertions; E2E-05 to E2E-08 |
| Database tests for uniqueness, foreign keys, transactions, concurrency | `packages/db` constraint tests; §7 concurrency tests |
| Frontend tests for form states, accessibility, responsive behaviour | `apps/web` feature tests; axe in E2E; E2E-11 |
| Playwright E2E for key workflows | §4 |
| Security tests (IDOR, privilege escalation, CSRF, malicious uploads, sessions) | `SECURITY-TESTING.md` |
| Backup restoration drills | `docs/08-operations/BACKUP-AND-RESTORE.md` §5 |

SRS §11.2 acceptance criteria are tracked in `docs/08-operations/GO-LIVE-CHECKLIST.md`. Every story in `docs/00-requirements/USER-STORIES.md` has acceptance criteria; each one maps to at least one test in the layers above, and the test name cites the story ID.
