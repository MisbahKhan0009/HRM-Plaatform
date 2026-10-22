# Backend coding standards

Status: **Accepted**, 2026-10-22. Normative for `apps/api` and `packages/{contracts,domain,db,auth,mailer}`. Biome enforces formatting and most lint rules; TypeScript strict mode and dependency-cruiser enforce the rest; reviewers check what tools cannot.

## 1. TypeScript configuration

`packages/config/tsconfig.base.json` sets, and no package may relax:

```jsonc
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "types": ["@cloudflare/workers-types"]   // apps/api only
  }
}
```

- `any` is banned (Biome `noExplicitAny` as error). Use `unknown` and narrow with Zod or a type guard.
- Non-null assertions (`x!`) are banned except in tests.
- `// @ts-ignore` is banned; `// @ts-expect-error <reason>` is allowed with a reason and a linked issue.
- Type-only imports use `import type`.

## 2. Naming

| Thing | Convention | Example |
|---|---|---|
| Files | kebab-case, role suffix | `leave-requests.service.ts`, `leave-requests.routes.ts` |
| Types, interfaces, Zod schemas | PascalCase; schema = type name + `Schema` | `LeaveRequestDto`, `LeaveRequestDtoSchema` |
| Functions, variables | camelCase, verb first for functions | `approveLeaveRequest`, `countLeaveUnits` |
| Constants | camelCase; SCREAMING_SNAKE only for env-derived constants | `maxPageSize`, `GMAIL_CLIENT_ID` |
| Enums | string literal unions from `@hrm/contracts`, not TS `enum` | `type LeaveStatus = 'pending' \| 'approved' ...` |
| Database columns | snake_case in SQL, camelCase in Drizzle | `work_date` / `workDate` |
| Permissions | from `@hrm/contracts/permissions`, never string literals in modules | `P.leave.request.review.team` |
| Error codes | SCREAMING_SNAKE, from `@hrm/contracts/errors` | `INSUFFICIENT_BALANCE` |
| Audit actions | `entity.verb_past` | `leave_request.approved` |

Names describe the domain: `employee`, not `user`, when the subject is an employee record (FR-EMP-012 keeps them distinct).

## 3. Layering

Layers and their allowed imports are defined in `docs/03-architecture/ARCHITECTURE.md` section 3 and `MONOREPO.md` section 2. In code review, check:

- Route handlers contain no `if` on business state. They validate, call one service function, map the result.
- Services own transactions. A repository function never opens a transaction; it accepts a `tx` (Drizzle transaction) argument.
- Domain functions are pure: no `Date.now()`, no `crypto.randomUUID()`, no I/O. Time, ids and configuration are parameters. This makes payroll and leave rules reproducible in tests.
- Policies are the only place permissions are checked. Services call `policy.assert...` before reading or writing.

## 4. Errors

### 4.1 Expected business outcomes: throw `AppError`

The API layer is request/response, and every failure must become a Problem Details response. Services therefore **throw** typed errors; a single error middleware maps them.

```ts
// packages/contracts/src/errors.ts
export const ErrorCode = { INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE', /* ... */ } as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// apps/api/src/lib/errors.ts
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 503,
    readonly detail?: string,
    readonly fieldErrors?: ReadonlyArray<{ path: string; code: string; message: string }>,
  ) { super(code); }
}
export const notFound = () => new AppError('NOT_FOUND', 404);
export const invalidTransition = (from: string, action: string) =>
  new AppError('INVALID_TRANSITION', 409, `Cannot ${action} from status ${from}.`);
```

### 4.2 Domain functions: return results

Pure domain functions that can fail for business reasons return a discriminated union so tests can assert on outcomes without exceptions:

```ts
export type LeaveCountResult =
  | { ok: true; units: Decimal; dates: string[] }
  | { ok: false; reason: 'NO_WORKING_DAYS' | 'SPANS_LEAVE_YEARS' };
```

The service converts `ok: false` into the matching `AppError`.

### 4.3 Rules

- Never catch an error just to log and rethrow; the middleware logs once with the request id.
- Catch only to translate: database unique violations (`23505`) become `409` with the documented code (`WORK_EMAIL_TAKEN`, `PAYROLL_RUN_EXISTS`, ...) through `mapDbError()`; never leak constraint names.
- Unknown errors become `500 INTERNAL_ERROR`, are reported to Sentry, and the response contains only `requestId`.
- Never use errors for control flow in loops.

## 5. Money and quantities

- Type `Money = { amount: Decimal; currency: 'BDT' }` inside the domain; `{ amount: string; currency }` on the wire (API-STANDARDS section 3).
- `import Decimal from 'decimal.js'` configured once in `packages/domain/src/decimal.ts`: `Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP })`. Every other file imports from there.
- Read `numeric` columns as strings (Drizzle `numeric({ mode: 'string' })`) and convert with `new Decimal(str)`. Write with `.toFixed(2)`.
- Banned for money: `number`, `parseFloat`, `Math.round`, `toFixed` on a `number`, `+` on strings. A Biome/grep CI rule flags `parseFloat` and `Number(` inside `packages/domain/src/payroll`.
- Leave units use the same Decimal type with 2 decimals.

## 6. Dates and time

- Business dates are `string` in `YYYY-MM-DD` form (branded type `IsoDate`). Do not convert them to `Date`, because a `Date` carries a time and a timezone.
- Instants are `Date` objects in code, `timestamptz` in the database, ISO strings with `Z` on the wire.
- Conversions go through `packages/domain/src/time.ts` (`toBusinessDate`, `businessDayBounds`, `addDays`, `eachDate`, `weekday`). Direct calls to `getDay()`, `getDate()`, `toLocaleDateString()` are banned in backend code.
- The current time is injected (`clock.now()`); tests use a fixed clock.

## 7. Validation

- All external input passes through a Zod schema from `@hrm/contracts` at the route (`@hono/zod-openapi` does this automatically). Services receive typed, validated objects.
- Schemas are `.strict()`; strings have max lengths; arrays have max sizes; numbers have bounds.
- Business validation (balance, overlaps, transitions) belongs to the service or domain, never in the Zod schema, because it needs database state.

## 8. Database access

- Always through repositories using Drizzle's query builder or `sql` template tag. String concatenation into SQL is banned.
- Every query on an organization-scoped table filters `company_id` through the `scoped(tx, ctx)` helper (DATABASE-CONVENTIONS section 6).
- Select only needed columns for lists. Never `SELECT *` into a response.
- Lists always have `LIMIT`. No N+1 queries: load related data with joins or `inArray`.

## 9. Logging

- Use the request-scoped `logger` from context (`c.var.logger`), which writes one JSON line per call to Workers Logs with `requestId`, `userId`, `route`.
- Levels: `debug` (local only), `info` (state transitions, job summaries), `warn` (recoverable problems, retries), `error` (unexpected failures).
- Never log: OTP codes, session tokens, cookies, TOTP secrets, national ID numbers, salary amounts, personal phone numbers or addresses, request bodies of auth and payroll routes. Log ids instead.
- Logs are diagnostic; the audit log is the business record (ARCHITECTURE section 7). Do not use logs as audit.

## 10. Configuration and secrets

- Read bindings and secrets only from the Hono context `c.env`, typed by `Env` in `apps/api/src/env.ts`. No `process.env` in the Worker.
- Business configuration comes from `settings` via `SettingsService.get(key)` with typed defaults from the catalogue (BUSINESS-RULES section 9).
- Secrets: `docs/08-operations/SECRETS.md`.

## 11. Performance on Workers Free (ADR-0009)

- Budget: 10 ms CPU per request. Network and database wait time does not count.
- Push aggregation into SQL. Do not load thousands of rows into JS to sum them.
- No synchronous crypto loops, no large JSON transforms, no PDF/XLSX generation in the Worker (D-037).
- Do not create clients per call: the DB client is created once per request from `c.env.HYPERDRIVE`.
- Avoid heavy dependencies; check bundle size impact in the PR (CI fails above the budget in ADR-0009).

## 12. Tests

- Every service function has tests for: success, each documented error code, and each scope (own, team, all, outside scope returns 404).
- Domain functions use table-driven tests and property-based tests with `fast-check` for arithmetic (proration sums, ledger balance equals sum of entries).
- Test names state behaviour: `it('rejects approval by the requester with SELF_APPROVAL_FORBIDDEN')`.
- Strategy and tooling: `docs/07-quality/TESTING-STRATEGY.md`.

## 13. Comments and documentation

- Comments explain why, not what. Cite the rule: `// D-017: leave never changes pay`.
- Public functions in `packages/domain` have a TSDoc line naming the rule section they implement (`BUSINESS-RULES 6.3`).
- No commented-out code, no TODO without an issue reference.
