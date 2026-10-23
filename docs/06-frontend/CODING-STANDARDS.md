# Frontend coding standards

Rules for `apps/web` and `packages/ui`. Repository-wide rules (Biome, commits, reviews) live in `docs/09-process/`; backend rules in `docs/05-backend/`. Biome enforces what it can; reviewers enforce the rest.

## 1. TypeScript

- `strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` (shared `tsconfig` in `packages/config`).
- No `any`. Use `unknown` and narrow. `as` casts only at trust boundaries with a comment explaining why; never `as unknown as T`.
- No non-null assertion (`!`) except on values guaranteed by a preceding check in the same function that the compiler can't follow; prefer restructuring.
- Types for API data come from `@hrm/contracts` (`z.infer`). Never redeclare an API type by hand in the frontend.
- Prefer `type` for unions and props; `interface` only when declaration merging is needed (router `Register`).
- Enums from the domain (statuses, categories) are string-literal unions exported by `@hrm/contracts`. No TypeScript `enum`.
- Dates stay `string` (`YYYY-MM-DD` or ISO) in state and props. Convert to `Date` only inside formatting or date-picker code, always with the company timezone (I18N.md section 5).
- Money stays `string`. Use `decimal.js` only in the rare UI-only computations that are explicitly display aids (none in v1). No `parseFloat` or `Number()` on money.

## 2. Files and naming

| Thing | Convention | Example |
|---|---|---|
| Folders, non-component files | `kebab-case` | `query-client.ts`, `leave-request-form/` |
| React component files | `PascalCase.tsx`, one exported component per file | `LeaveRequestForm.tsx` |
| Hooks | `useCamelCase`, file `use-camel-case.ts` | `useCan`, `use-can.ts` |
| Route files | TanStack Router conventions | `_app/leave/requests/$requestId.tsx` |
| Tests | next to the file, `*.test.ts(x)` | `LeaveRequestForm.test.tsx` |
| i18n keys | `module.screen.element` | `leave.request.submit` (I18N.md section 2) |
| Query keys | arrays starting with the module | `['leave','requests',params]` |

- **Named exports only.** Default exports are allowed only where a tool requires them (Vite config, lazy route files if the router plugin needs them).
- No barrel files except each feature's and package's `index.ts` (public API). Inside a feature, import files directly.
- Imports across packages go through the package name (`@hrm/ui`), never relative paths.

## 3. Components

- Function components only. Props typed with a `type XProps`; no `React.FC`.
- **Composition over configuration** (vercel-composition-patterns skill). Prefer compound components (`<Card><CardHeader/>…`) and `children` over many boolean props. A component with more than ~3 boolean props that change layout should be split.
- **Presentational vs container**: components in `packages/ui` and `features/*/components` receive data via props and emit events; they don't call the API. Pages (`features/*/pages`) wire queries, mutations and navigation.
- Accessibility is part of the component: semantic element first (`button`, `a`, `table`, `label`), Radix primitive second, `aria-*` third. Every interactive element is keyboard reachable with a visible focus ring from the token (THEMING-AND-TOKENS.md).
- Styling with Tailwind classes that map to tokens (`bg-surface`, `text-text-2`, `rounded-bm`). No hex values, no arbitrary colour values (`bg-[#...]`), no inline `style` for colours. Use `cn()` (clsx + tailwind-merge) to merge classes; variants with `cva`.
- Lists render stable `key`s (record `id`), never array indexes for data rows.
- No `useEffect` for data fetching (TanStack Query), for deriving state (compute during render or `useMemo` when measurably expensive), or for syncing props to state. Effects are for subscriptions and imperative APIs (focus, observers) only.
- Avoid premature memoisation. `memo`, `useMemo`, `useCallback` only where a profiler shows a cost or a library needs referential stability (TanStack Table columns, React Hook Form resolvers).
- Context only for app-wide concerns (theme, auth, step-up). Feature state lives in the URL (search params) or in TanStack Query; local UI state in `useState`.
- Error states, empty states and loading skeletons are part of done for every data component (SCREEN-INVENTORY.md section 0).

## 4. Business logic boundary

The frontend must not decide anything the server decides (README non-negotiables):

| Allowed in the frontend | Not allowed |
|---|---|
| Formatting values for display | Counting leave working days (call `POST /leave/requests/preview`) |
| Client-side validation from the shared Zod schema (same rules as the server) | Computing payroll totals, proration or balances |
| Hiding actions the user lacks permission for | Deciding whether a status transition is valid beyond hiding buttons |
| Disabling submit while blocking validation results exist, as reported by the API | Inferring attendance status from events |
| Building CSV/XLSX/PDF from data the API returned (D-037) | Adding or changing numbers in exports or payslips |

## 5. Hooks

- A custom hook does one thing and is named for it (`useLeaveBalances`, `useCan`).
- Hooks that wrap queries return the TanStack Query result as is (don't re-wrap into custom loading flags).
- Mutation hooks own their invalidation (ARCHITECTURE.md section 5) and accept `onSuccess` callbacks for navigation.
- Rules of hooks enforced by the linter.

## 6. Forms and tables

Follow FORMS-AND-VALIDATION.md and TABLES-AND-LISTS.md. Don't build ad-hoc forms with uncontrolled inputs and manual `fetch`.

## 7. Security in the browser

- Never use `dangerouslySetInnerHTML`. User-entered text (comments, reasons, names) renders as text.
- Never put personal data, money or tokens in `localStorage`, `sessionStorage`, URLs or logs. `localStorage` holds only the theme value, sidebar collapsed state and table density.
- Links to external sites (none expected) use `rel="noopener noreferrer"`.
- File downloads go through `GET /documents/{id}/download` (attachment); never render uploaded HTML or SVG inline.
- Search params never carry personal data beyond record ids and filter values.

## 8. Performance

- Route-level code splitting; dynamic import of `@hrm/documents` (PDF, XLSX) at the moment of use.
- Images: logos as SVG; no other images in v1.
- Lists over 200 rows on one screen are a design bug; paginate (TABLES-AND-LISTS.md).
- Budgets and measurement: `docs/07-quality/PERFORMANCE-BUDGETS.md`.

## 9. Testing expectations

Per `docs/07-quality/TESTING-STRATEGY.md`. For every component in `packages/ui`: states (default, hover, focus, disabled, error) and keyboard behaviour in both themes. For every feature page: loading, empty, error and success states, field errors after a failed submit, and permission-based visibility of actions. Use Testing Library queries by role and name, never by class or test id unless no accessible name exists.

## 10. Comments and documentation

- Comment why, not what. Link decision IDs when code exists because of one (`// D-016: pending requests reserve balance`).
- Each `packages/ui` component has a short doc comment stating its purpose and the COMPONENT-SPECS.md section it implements.
