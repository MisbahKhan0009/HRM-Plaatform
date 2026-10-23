# API standards

Status: **Accepted**, 2026-10-22. Normative for every endpoint under `/api/v1`. The endpoint list is in `API-CATALOGUE.md`; the authorization model in `docs/03-architecture/SECURITY-MODEL.md`.

## 1. Base and versioning

- Base path: `/api/v1` (SRS §4.2), same origin as the web app (`https://hrm.<account>.workers.dev`).
- A breaking change (removed field, changed meaning, new required input) needs a new major path (`/api/v2`) or an additive alternative. Additive changes (new optional input, new response field, new endpoint, new enum value documented in advance) stay in v1.
- Clients must ignore unknown response fields. The web app and future native apps (D-004) share this API.

## 2. Resources and URLs

- Plural, kebab-case nouns: `/employees`, `/leave/requests`, `/payroll/runs`, `/reimbursement-claims`.
- Identifiers in paths are UUIDs (`/employees/0192f0c4-...`). Human codes (`EMP-0001`) are fields, filterable with `?code=`.
- Nesting is one level deep and only for ownership: `/employees/{id}/documents`. Use filters for everything else (`/leave/requests?employeeId=`).
- Self-service uses `me`: `/attendance/me`, `/leave/balances/me`, `/payroll/payslips/me`. The server derives the employee from the session (FR-ATT-012); `me` endpoints never accept an `employeeId`.

### Methods

| Method | Use | Body | Success |
|---|---|---|---|
| `GET` | Read | none | `200` |
| `POST` (collection) | Create | JSON | `201` + `Location` header + resource |
| `PATCH` | Partial update of editable fields | JSON (with `version`) | `200` + resource |
| `POST /{id}/{action}` | State transition or command | JSON (may be `{}`) | `200` + resource, or `202` for queued work |
| `DELETE` | Only for drafts and links (for example a draft leave request, a role grant) | none | `204` |

`PUT` is not used.

### State transitions are actions

A status field is never writable through `PATCH` (SRS §8.7). Each transition in `DOMAIN-MODEL.md` section 5 has an action endpoint, named with the verb:

```text
POST /leave/requests/{id}/submit
POST /leave/requests/{id}/approve      { "comment": "Enjoy", "version": 3 }
POST /payroll/runs/{id}/lock           Idempotency-Key: 6a1f...
```

An invalid transition returns `409 INVALID_TRANSITION` with the current status in `detail`.

## 3. Wire format

- JSON, UTF-8, `Content-Type: application/json`. File uploads use `multipart/form-data`.
- Property names are **camelCase** (`employeeCode`, `startDate`). Query parameters are camelCase too.
- Enum values are the lowercase snake_case strings from `DOMAIN-MODEL.md` section 4 (`"notice_period"`).
- Dates: `"2026-11-03"` (ISO 8601 calendar date, business date in `Asia/Dhaka`).
- Timestamps: `"2026-11-03T04:12:09.123Z"` (ISO 8601, always UTC with `Z`).
- Time of day: `"09:30"` (24 h, schedule timezone).
- Money: an object with a **string** amount, never a JSON number (ADR-0006):

```json
{ "grossAmount": { "amount": "45000.00", "currency": "BDT" } }
```

- Leave quantities: string decimals, `"1.5"`.
- `null` means "known to be empty". An absent property in a response means "you are not allowed to see it" or "not applicable"; DTOs document which.
- Every resource returns `id`, `version`, `createdAt`, `updatedAt` (except append-only records, which have no `version`/`updatedAt`).

## 4. Authentication and CSRF

- Browser clients authenticate with the Better Auth session cookie (`HttpOnly; Secure; SameSite=Lax`). Details: `AUTH-IMPLEMENTATION.md`.
- Every state-changing request (`POST`, `PATCH`, `DELETE`) must carry an `Origin` header equal to the app origin; the CSRF middleware rejects others with `403 CSRF_ORIGIN_MISMATCH`. `SameSite=Lax` is the second layer.
- Unauthenticated requests get `401 UNAUTHENTICATED`. Privileged roles on a session without strong auth get `403 MFA_REQUIRED`. Sensitive actions on a session older than 15 minutes since strong auth get `403 REAUTH_REQUIRED`.
- Bearer tokens for native apps are reserved (D-004) and not enabled in v1.

## 5. Pagination

All list endpoints paginate (NFR-PERF-002) with **page-based** pagination.

```text
GET /employees?page=2&pageSize=25&sort=lastName,-joiningDate&status=active
```

```json
{
  "data": [ { "...": "..." } ],
  "page": { "number": 2, "size": 25, "totalItems": 47, "totalPages": 2 }
}
```

- `page` starts at 1; `pageSize` default 25, maximum 100. Values outside the range return `400 VALIDATION_FAILED`.
- Justification: the largest lists are about 50 employees and about 20,000 attendance rows per year, so `OFFSET` is cheap, and HR users need page numbers and totals in tables. Cursor pagination's advantages (stable deep paging over millions of rows) do not apply at this size.
- Long append-only lists (`/audit-logs`, `/attendance`) **require** a date range filter (maximum 366 days) so a query never scans unbounded history.
- Every list has a deterministic sort: the requested sort plus `id` as the final tie-breaker.

## 6. Filtering and sorting

- Each endpoint declares an **allow-list** of filter and sort fields in its Zod query schema. Unknown parameters return `400 VALIDATION_FAILED` (no silent ignoring, no passing names into SQL).
- Filters: exact match `status=active`; multiple values `status=active,probation`; ranges `from=2026-01-01&to=2026-01-31`; text search `q=` (min 2 characters, on name/code fields only).
- Sort: `sort=field` ascending, `sort=-field` descending, comma-separated, maximum 3 fields.
- Filters never widen access: the scope from the policy is always applied first, then the user's filters.

## 7. Errors

Errors use RFC 9457 Problem Details, `Content-Type: application/problem+json`.

```json
{
  "type": "https://hrm.local/problems/leave-insufficient-balance",
  "title": "Not enough leave balance",
  "status": 422,
  "code": "INSUFFICIENT_BALANCE",
  "detail": "Requested 3 days, 1.5 days available.",
  "requestId": "01JC9X...",
  "errors": []
}
```

- `code` is stable and machine-readable; the UI maps it to a translated message (`docs/06-frontend/I18N.md`). `title` and `detail` are English, for developers and logs, and never contain personal data beyond what the caller already sent.
- `requestId` matches the `X-Request-Id` response header and the log line.
- 5xx responses never include stack traces or SQL.

### Validation errors

`400 VALIDATION_FAILED` lists every failing field, with JSON Pointer paths relative to the body or `query`:

```json
{
  "status": 400, "code": "VALIDATION_FAILED", "title": "Invalid input",
  "errors": [
    { "path": "/endDate", "code": "date_before_start", "message": "End date is before start date." },
    { "path": "query/pageSize", "code": "too_big", "message": "Must be at most 100." }
  ]
}
```

Field `code` values are the Zod issue code or a custom code from `@hrm/contracts`.

### Error code catalogue

| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Body or query fails schema |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | Endpoint requires `Idempotency-Key` and it is missing |
| 401 | `UNAUTHENTICATED` | No valid session |
| 401 | `OTP_INVALID` | Wrong or expired email code |
| 401 | `TOTP_INVALID` | Wrong authenticator or recovery code |
| 403 | `FORBIDDEN` | Authenticated, lacks the permission (resource exists and caller may know it) |
| 403 | `MFA_REQUIRED` | Privileged role on a weak session |
| 403 | `REAUTH_REQUIRED` | Sensitive action needs recent strong auth |
| 403 | `ACCOUNT_SUSPENDED` | User status `suspended` or `deactivated` |
| 403 | `CSRF_ORIGIN_MISMATCH` | Origin header missing or wrong |
| 403 | `SELF_APPROVAL_FORBIDDEN` | Approver is the requester (FR-WF-004) |
| 404 | `NOT_FOUND` | Missing, or exists outside the caller's scope (IDOR rule) |
| 409 | `VERSION_CONFLICT` | `version` does not match (someone else saved first) |
| 409 | `INVALID_TRANSITION` | Action not allowed from the current status |
| 409 | `EMAIL_TAKEN` | A user with this login email already exists (case-insensitive) |
| 409 | `WORK_EMAIL_TAKEN` | Another employee has this work email (FR-EMP-009) |
| 409 | `EMPLOYEE_ALREADY_LINKED` | The employee already has a user, or the user already has an employee (FR-AUTH-010) |
| 409 | `DEPARTMENT_CODE_TAKEN` | Department code already used |
| 409 | `DUPLICATE` | Any other unique constraint (employee code, holiday date, cheque number ...); `errors[].path` names the field |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Same key with a different request body |
| 409 | `IDEMPOTENCY_IN_PROGRESS` | Same key, first request still running |
| 409 | `PAYROLL_RUN_LOCKED` | Change would modify a locked payroll run (or a closed payroll period) |
| 409 | `PAYROLL_RUN_EXISTS` | A regular payroll run already exists for the period |
| 409 | `SELF_MANAGER` | Employee set as their own manager (FR-ORG-004) |
| 409 | `REPORTING_CYCLE` | Manager assignment would create a cycle (FR-ORG-005) |
| 409 | `ALREADY_CHECKED_IN` / `NOT_CHECKED_IN` | Attendance punch out of order |
| 409 | `OVERLAPPING_LEAVE` | Overlaps an existing active leave request |
| 409 | `PAYMENT_AMOUNT_MISMATCH` | Recorded payments would exceed the item's net amount, or reconciliation totals disagree (FR-PAY-015) |
| 413 | `FILE_TOO_LARGE` | Upload over 10 MB |
| 415 | `UNSUPPORTED_FILE_TYPE` | MIME or magic bytes not in allow-list |
| 422 | `INVALID_DATE` | A date breaks a business rule: in the future for attendance, outside the correction window, before joining, spanning two leave years |
| 422 | `INSUFFICIENT_BALANCE` | Not enough available leave balance and the policy forbids a negative balance |
| 422 | `LEAVE_NOT_ELIGIBLE` | Policy eligibility not met |
| 422 | `LEAVE_NO_WORKING_DAYS` | Range contains only weekends and holidays |
| 422 | `PAYROLL_MISSING_SALARY_STRUCTURE` | `submit` blocked: an eligible employee has no approved salary structure; `errors` lists every blocking item |
| 422 | `PAYROLL_NEGATIVE_NET` | `submit` blocked: an item's net amount is negative |
| 422 | `PAYROLL_CURRENCY_MISMATCH` | `submit` blocked: an input is not in the run currency |
| 422 | `PAYROLL_MIDPERIOD_SALARY_CHANGE_UNCONFIRMED` | `calculate` blocked: an employee's salary changes inside the period and the owner has not set the mid-period policy (BUSINESS-RULES 6.3) |
| 422 | `SELF_APPROVAL_NOTE_REQUIRED` | Payroll self-approval without justification (D-007) |
| 422 | `BUSINESS_RULE_VIOLATION` | Other documented rule; `detail` names it |
| 429 | `RATE_LIMITED` | Too many requests; `Retry-After` header set |
| 500 | `INTERNAL_ERROR` | Unexpected failure |
| 503 | `DEPENDENCY_UNAVAILABLE` | Database or R2 unreachable |

Adding a code is additive; renaming or removing one is a breaking change.

### Payroll blocking codes

When `submit` finds blocking validation flags, the top-level `code` is the first present in this order: `PAYROLL_MISSING_SALARY_STRUCTURE`, `PAYROLL_NEGATIVE_NET`, `PAYROLL_CURRENCY_MISMATCH`. `errors` lists every blocking item across all employees as `{ "path": "/items/<payrollItemId>", "code": "<flag>", "message": "..." }`, so the UI shows all problems at once.

## 8. Optimistic locking

Every mutable resource has an integer `version`. `PATCH` bodies and transition actions on editable resources include the `version` the client last read. The repository updates `WHERE id = $1 AND version = $2` and increments it; zero rows updated returns `409 VERSION_CONFLICT`. The UI then reloads and shows the user what changed (`docs/06-frontend/FORMS-AND-VALIDATION.md`).

## 9. Idempotency

Commands with money or ledger effects require an `Idempotency-Key` header (8 to 100 characters, a UUID v4 from the client is recommended):

`POST /payroll/runs`, `/payroll/runs/{id}/calculate`, `/submit`, `/approve`, `/lock`, `/payments`, `/payments/import`, `/publish-payslips`, `/leave/requests/{id}/approve`, `/leave/requests/{id}/cancel/approve`, `/leave/balances/adjustments`, `/payroll/adjustments`.

Behaviour (stored in `idempotency_records` for 24 h, scoped to user + operation):

| Situation | Response |
|---|---|
| New key | Execute, store status + body, return it |
| Same key, same body hash, completed | Return the stored response with header `Idempotent-Replayed: true` |
| Same key, different body | `409 IDEMPOTENCY_KEY_REUSED` |
| Same key, still in progress | `409 IDEMPOTENCY_IN_PROGRESS` |

Other `POST` actions are idempotent by state: approving an already-approved request returns `409 INVALID_TRANSITION` without side effects.

## 10. Rate limits

Stored in the database (`rate_limits`) because Worker memory is per isolate.

| Route group | Limit | Key |
|---|---|---|
| `POST /auth/email-otp/send-verification-otp` | 3 per 10 min | email; plus 20 per 10 min per IP |
| `POST /auth/sign-in/email-otp`, `/auth/two-factor/verify-totp`, `/auth/step-up/*` | 5 per 10 min | email or user; plus IP |
| Other `/auth/*` | 30 per min | IP |
| `POST /attendance/check-in`, `/check-out` | 10 per min | user |
| File upload | 20 per 10 min | user |
| All other API | 300 per min | user |

Exceeding returns `429 RATE_LIMITED` with `Retry-After` in seconds.

## 11. Response headers

Every response: `X-Request-Id`, `Cache-Control: no-store` (all API data is private), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. The SPA document adds a strict `Content-Security-Policy` (`docs/08-operations/DEPLOYMENT.md`).

## 12. OpenAPI

- Routes are defined with `@hono/zod-openapi` (`createRoute`) using schemas from `@hrm/contracts`. The OpenAPI 3.1 document is generated from the same definitions (NFR-MNT-004), served at `GET /api/v1/openapi.json` in non-production environments, and written to `apps/api/openapi.json` by `pnpm --filter @hrm/api openapi`.
- CI regenerates the file and fails if it differs from the committed copy, so every API change shows up in review.
- A contract test (`apps/api/test/openapi.contract.test.ts`) calls every documented operation with a valid fixture and validates each response against its declared schema, and fails if any registered route is missing from the document (SRS §8.7).
- Every operation declares `operationId` (camelCase, `module.action`, for example `leaveRequests.approve`), `tags` (module), `security`, the permission in `x-permission`, and all error responses it can return.

## 13. DTO rules

- Response DTOs are named `<Entity><View>` (`EmployeeBasic`, `EmployeeFull`, `EmployeeSelf`) and built by explicit mapper functions, never by returning a database row (SECURITY-MODEL section 5).
- Request DTOs are named `<Action><Entity>Input` (`CreateEmployeeInput`, `ApproveLeaveRequestInput`).
- Inputs are strict Zod objects (`.strict()`): unknown properties return `400`.
- Text inputs are trimmed; empty strings become `null` only where the DTO says so.

