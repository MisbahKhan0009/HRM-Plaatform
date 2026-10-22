# Component specifications

The app component library, built in `packages/ui` from shadcn/ui (Radix primitives) and restyled with the Big-Matrix tokens. Every value below is a token name from `docs/02-brand/source/tokens.json` or an app token from `docs/02-brand/APP-UI-ADAPTATION.md`; the token-to-CSS pipeline is in `docs/06-frontend/THEMING-AND-TOKENS.md`. Components read **role tokens** (`ground`, `surface`, `text`, `action` ...), never `bm-*` hex values, so they work in Ink (default) and Paper.

Section numbers are referenced from other design docs; keep them stable.

## 1. Foundations used by every component

| Concern | Rule | Tokens |
|---|---|---|
| Type | UI text 14px or 15px Inter (`small` scale); body 16px; page titles `h1` scaled to 28px to 32px in the app (Inter Tight 600); section titles `h3` at 20px; labels and table headers mono `label` style in `text-3` | `body`, `small`, `h1`, `h3`, `label`, `caption`, `stat` |
| Spacing | Only steps of the 4px scale | `space-4` to `space-64` |
| Radius | Controls `bm-r` (6px); cards, dialogs, popovers `bm-r-lg` (10px); badges and pills `bm-r-pill`; nothing rounder | `bm-r`, `bm-r-lg`, `bm-r-pill` |
| Elevation | No drop shadows. Separation by `surface` + 1px `line` border. Exceptions: the primary button's `shadow-primary`; overlays (dialog, popover, menu) get a `line-strong` border and the backdrop | `shadow-primary` |
| Focus | Every interactive element: solid outline `focus-width` (2px) in `accent`, offset `focus-offset` (2px), on `:focus-visible` only | `accent`, `focus-width`, `focus-offset` |
| Control boundary | Inputs, selects, checkboxes and radios use `control-border` so their edge meets 3:1 (WCAG 1.4.11); `line-strong` is below 3:1 | `control-border` (app token, see section 1.1) |
| Icons | Lucide, outline, 1.5px stroke (`icon-stroke`), 16px inline and 20px in buttons, 24px (`icon-size`) standalone; colour `text-2`, `accent` only for the active or key item | `icon-size`, `icon-stroke` |
| Motion | 120ms to 200ms ease-out for hover, open and close; none for data changes; all motion disabled under `prefers-reduced-motion: reduce` | none |

### 1.1 App token added by this spec

| Token | Ink | Paper | Contrast | Use |
|---|---|---|---|---|
| `control-border` | #70747B | #858585 | 3.53:1 on `surface` (Ink), 4.06:1 on `ground` (Ink); 3.54:1 on `ground-2` (Paper), 3.69:1 on `ground` (Paper) | Resting border of form controls |

This token is proposed here to satisfy APP-UI-ADAPTATION.md section 5 ("`line` and `line-strong` are below 3:1"). It must be added to `docs/02-brand/APP-UI-ADAPTATION.md` section 4 to become canonical.

## 2. Button

shadcn `Button`. Label first, verb first, sentence case (CONTENT-STYLE.md). The brand arrow (→) is used only on navigation-style buttons that go to another page ("Open payroll run →"), never on buttons that perform an action in place.

| Variant | Fill | Label | Border | Hover | Use |
|---|---|---|---|---|---|
| `primary` | `action` | `on-action` | none | `action-hover` | The one main action of the view. Carries `shadow-primary`. |
| `secondary` | `ground` (on `surface`: `surface`) | `text` | 1px `control-border` | border `text` | Alternatives |
| `text` | none | `link` | none | underline | Low-emphasis actions, in tables and inline |
| `destructive` | `ground` | `bad` | 1px `bad` | fill `bad-tint` | Delete, deactivate, reject. Never red-filled, so it is not confused with the primary |
| `icon` | none | `text-2` | none | fill `ground-2` | Toolbar and row actions. Requires `aria-label` and a tooltip |

- Sizes: `md` 40px high, padding `space-12` × `space-16`, `button` type style; `sm` 32px high for tables and toolbars; `lg` 48px for mobile primary actions and the check-in button. Minimum target 24 × 24px (WCAG 2.5.8); mobile targets 44px.
- States: hover, `:focus-visible` outline, pressed (no transform), disabled (50% opacity, `aria-disabled` kept focusable only when a tooltip explains why), loading (spinner replaces the leading icon, label stays, `aria-busy="true"`, button disabled to prevent double submit).
- Rule: one `primary` per view. A dialog is a view: its own primary replaces the page's while open.

## 3. Text inputs

shadcn `Input`, `Textarea`, wrapped by our `Field` (label, control, hint, error).

- Anatomy: label above (body 14px, 500, `text`); control; hint below (`small` in `text-2`); error below the hint (`small` in `bad` with an alert icon and the text, never colour alone).
- Control: height 40px, padding `space-12`, fill `ground-2`, border 1px `control-border`, radius `bm-r`, text `text`, placeholder `text-3` (placeholders are examples, never labels).
- States: hover border `text-2`; focus outline as section 1; invalid border `bad` plus `aria-invalid="true"` and `aria-describedby` pointing at the error; disabled fill `ground` with text `text-3`; read-only shows the value as plain text with no border.
- Required fields: label suffix "(required)" in `text-2` is not used; instead optional fields carry "(optional)". Most fields in this app are required.
- Variants: `MoneyInput` (prefix `৳`, mono tabular, right-aligned, accepts `1,234.50`, sends a decimal string), `CodeInput` for 6-digit codes (single field, `inputmode="numeric"`, `autocomplete="one-time-code"`), `SearchInput` (leading search icon, clear button).

## 4. Select and combobox

- `Select` (shadcn/Radix) for up to 10 fixed options (leave type, payment method, category).
- `Combobox` (shadcn `Command` in a `Popover`) for searchable lists (employee, department, position, manager). Shows code and name: `EMP-0001 · Rahim Uddin`. Async search with 250ms debounce; minimum 1 character.
- Trigger styled like an input (section 3). Menu: `surface` fill, `line-strong` border, `bm-r-lg`, item height 36px, selected item `accent-tint` with a check icon, active (keyboard) item `ground-2`.
- Multi-select filters use checkboxes inside the menu and show the count in the trigger ("Status: 3").

## 5. Date and date-range picker

shadcn `Calendar` (react-day-picker) in a `Popover`; bottom sheet on mobile.

- Input shows the formatted date (CONTENT-STYLE.md section 8: `22 Oct 2026`) and accepts typed `YYYY-MM-DD` or `DD/MM/YYYY`. The value sent to the API is always `YYYY-MM-DD`.
- Week starts on **Sunday** (Bangladesh working week, D-005). Weekend days (from the user's schedule, default Fri and Sat) are shown in `text-3`; holidays carry a dot and the holiday name in the day's accessible label.
- Range picker shows two months on desktop, one on mobile; the selected range uses `accent-tint` with start and end in `action` fill and `on-action` text.
- Leave forms pass the employee's schedule and holidays so non-working days are marked, but they remain selectable; the server counts working days.
- Today has a 1px `accent` ring. Dates outside min or max are disabled with `aria-disabled`.

## 6. File upload

- Anatomy: drop zone (dashed 1px `control-border`, `ground-2`, `bm-r-lg`, 120px high) with icon, "Drag a file here or browse", and the rule line "PDF, JPG or PNG, up to 10 MB". The browse control is a real `<input type="file">` behind a `secondary` button.
- After selection: file row with name, size, type icon, progress bar (accent on `line`), remove button. Errors in the row (`bad`, text and icon).
- Client checks extension, MIME type and size before upload; the server checks again (ARCHITECTURE.md section 5). Images over 1600px on the long edge are resized in the browser before upload (ADR-0009 guardrail).
- One file per document version. Multiple selection is off except for the CSV import.

## 7. Data table

TanStack Table with shadcn `Table` markup. Behaviour (server pagination, sorting, filtering, column visibility, export, mobile cards) is in `docs/06-frontend/TABLES-AND-LISTS.md`.

- Header row: `ground-2` fill, mono `label` style, `text-3`, height 40px; sortable headers are buttons with a sort icon and `aria-sort`.
- Body rows: height 44px (comfortable) or 36px (compact, user toggle), 1px `line` bottom border, hover `ground-2`, selected `accent-tint`.
- Cell content: text left-aligned; numbers, money and durations right-aligned in mono tabular figures; codes in mono; status as badge (section 10); dates in the short format.
- Row actions: trailing column with up to two `icon` or `text` buttons and a "More" menu. The whole row is not a click target unless the table is a navigation list; then the first cell holds a real link.
- Sticky header and first column on wide tables. Horizontal scroll inside the table container, never the page.
- Totals row (payroll): `ground-2`, 600 weight, top border `line-strong`.
- Table container: `surface`, 1px `line`, `bm-r-lg`, with toolbar above (search, filters, column menu, export) and pagination below.

## 8. Filters and search

- Toolbar: search input (left), filter chips (one per active filter: "Department: Finance ✕"), **Filters** `secondary` button opening a popover or a sheet on mobile, "Reset" `text` button when any filter is active.
- Filters reflect in the URL search params (shareable, back-button safe); see TABLES-AND-LISTS.md.
- Default filters are visible as chips (for example "Status: not archived") so the user knows the list is filtered.

## 9. Pagination

- Below the table: "1 to 25 of 132" (mono numbers), page size select (25, 50, 100), previous and next `icon` buttons, and a page number input for jumps. Labels: "Previous page", "Next page".
- Mobile: previous and next only, plus the range text.

## 10. Status badge

shadcn `Badge` restyled. Pill (`bm-r-pill`), height 22px, padding `space-4` × `space-8`, `caption`-size mono caps label (11px, 500, tracking +0.08em), leading 6px dot or 12px icon. Text is always present (NFR-UX-003).

| Tone | Fill | Text and dot | Statuses (DOMAIN-MODEL enums) |
|---|---|---|---|
| `neutral` | `ground-2` | `text-2` | `draft`, `invited`, `not_employed`, `weekend`, `withdrawn`, `cancelled`, `skipped`, `pending` (outbox only) |
| `warn` | `warn-tint` | `warn` | `pending`, `submitted`, `cancellation_pending`, `calculated`, `returned`, `preboarding`, `probation`, `notice_period`, `missing_punch`, `short_hours`, `missed_core`, `unpaid`, `processing` |
| `ok` | `ok-tint` | `ok` | `approved`, `active`, `present`, `paid`, `reconciled`, `included`, `applied`, `sent` |
| `bad` | `bad-tint` | `bad` | `rejected`, `failed`, `dead`, `absent`, `separated`, `suspended`, `deactivated` |
| `info` | `accent-tint` | `accent-text` | `on_leave`, `holiday` |
| `locked` | `ground-2` | `text` with lock icon | `locked`, `archived` |

Label text comes from i18n keys `status.<enum>` (I18N.md), for example `status.cancellation_pending` = "Cancellation pending". Contrast of every pair is listed in ACCESSIBILITY.md section 3.

Special badges: "Self-approved" (`warn`, shield icon) on payroll runs with `self_approved = true`; "Manual" and "Corrected" (`neutral`) on attendance records.

## 11. Cards and KPI

- `Card`: `surface`, 1px `line`, `bm-r-lg`, padding `space-16` (mobile) or `space-24` (desktop); optional header with mono `label` and a title in Inter Tight 600 17px. No coloured side borders, no shadows.
- `StatBar` (brand component adapted): equal cells on `ground`, `line-strong` outline and dividers, a 20px `accent` tick on each cell's top edge, value in `stat` style (28px, tabular), label in `caption` style `text-3`. App use: leave balances, payroll totals, dashboard counts, report summaries. 2 to 4 cells per bar; more than 4 wraps into a grid of bars on mobile (2 per row). Values come from the API, never computed in the UI.
- `KpiCard` (single number with label and optional delta text "Up 3 from last month"; the delta is text, never just an arrow or colour).

## 12. Dialogs and confirmation

shadcn `Dialog` and `AlertDialog`; `Sheet` on mobile for forms.

- Dialog: `surface`, 1px `line-strong`, `bm-r-lg`, max width 480px (forms 640px), padding `space-24`; backdrop `bm-ink` at 60% (both themes). Title Inter Tight 600 20px; description `text-2`. Footer: actions right-aligned, primary last (rightmost); on mobile, stacked full width with primary first.
- Focus moves to the first field, or to the least destructive button for confirmations. Escape and the close button cancel. Focus returns to the trigger on close.

Confirmation levels:

| Level | When | Pattern |
|---|---|---|
| 1. None | Reversible, low impact (save preferences, filter) | Act, then toast |
| 2. Confirm | Destructive or notifies others (withdraw request, reject, suspend user, publish payslips) | `AlertDialog`: consequence in plain words, confirm button labelled with the verb ("Reject request"), cancel "Keep it" or "Cancel" |
| 3. Confirm with summary | Financial state changes (submit run, approve run, record payment) | As level 2 plus a summary block (StatBar or key-value list with totals in `৳`) |
| 4. Typed confirmation + re-auth | Irreversible financial or security actions (lock payroll run, change roles, deactivate user, regenerate recovery codes) | As level 3 plus an input where the user types the run number or the user's email; the button enables only on an exact match; the API may require re-auth (USER-FLOWS.md 1.4) |

Destructive confirm buttons use the `destructive` variant. Financial confirm buttons use `primary`. Copy for each payroll confirmation: CONTENT-STYLE.md section 7.

## 13. Empty state (brand moment)

- Container: `surface` card with a positioned inner panel carrying `Glow` (main glow only) then `DotGrid` (default 22px pitch), then content, per brand stacking order.
- Content: 40px Lucide icon in `text-2`, title (Inter Tight 600 18px), one sentence in `text-2`, optional primary action (only if the page has no other primary), optional `text` link to help.
- Variants: `first-use` (nothing exists yet; shows the create action), `no-results` (filters matched nothing; shows "Reset filters" as `secondary`, no DotGrid to keep it quiet in tables), `no-access` is not an empty state (404 page instead).

## 14. Skeleton

- Blocks in `ground-2` (on `ground`) or `line` (on `surface`), radius matching the real element, shimmer animation 1.2s, disabled under reduced motion.
- Shapes: table (header + 8 rows matching column widths), card, StatBar, form (label + input pairs), profile header.
- Container has `aria-busy="true"` and a visually hidden "Loading <thing>" text. Skeletons show after 150ms to avoid flicker on fast responses.

## 15. Approval item

Used in `/approvals` and dashboard widget 6.

- Anatomy (one card or row): subject type icon and label (mono `label`: "LEAVE REQUEST"), requester name and code, one-line summary ("Casual leave, 3 to 5 Nov, 3 days"), submitted age ("2 days ago", full date in a tooltip and `title`), status badge, and actions.
- Actions: `text` **Review** opens `/approvals/$approvalId`. Inline **Approve** is allowed only for subject types without required comments or financial impact (leave, attendance correction); payroll items always open the detail page.
- Overdue items (older than 3 working days) show a `warn` "Waiting 4 days" badge. The threshold is a setting; see open questions.

## 16. Timeline and history

For approval history, employment history and record history.

- Vertical list; each entry: 8px dot (`accent` for the latest, `line-strong` otherwise) on a 1px `line` rail, actor name, action phrase ("approved", "returned to draft"), timestamp (relative with absolute in tooltip), optional comment in a quoted block (`ground-2`, `bm-r`), optional field diff table (field, before, after).
- Entries are immutable and newest first. There are no edit or delete affordances.
- `<ol>` with each entry an `<li>`; times in `<time datetime>`.

## 17. Page header

Breadcrumb (two levels max, `small`, `text-2`), title (`h1` app size), human code in mono `text-2` after the title, status badge, actions aligned right (primary rightmost). On mobile: breadcrumb becomes a back link, actions move into a sticky bottom bar (primary full width) plus a "More" menu.

## 18. Sidebar

- Width 248px (desktop), collapsible to 64px icon rail (state remembered per device). Fill `ground`, right border 1px `line`.
- Top: logo (theme lockup). Groups: mono `label` heading `text-3`; items 36px high, icon 20px `text-2`, label `text`; active item `accent-tint` fill, 2px `accent` bar on the leading edge, icon `accent`; badge (count) right-aligned, `bm-r-pill`, `ground-2` fill, mono.
- Uses `<nav aria-label="Main">` with lists; the active link has `aria-current="page"`.
- Below 1024px it becomes a `Sheet` drawer (left), opened by the top bar menu button.

## 19. Top bar

Height 56px, fill `ground`, bottom border 1px `line`, sticky. Contents and order: INFORMATION-ARCHITECTURE.md section 4.1. Icon buttons use the `icon` button variant with tooltips. The check-in shortcut is a `secondary` button (the page's primary stays in the content area).

## 20. Theme toggle

- `icon` button showing a sun in Ink ("Switch to light theme") and a moon in Paper ("Switch to dark theme"); also a two-option radio group on `/me/preferences`.
- Switching sets `data-theme` on `<html>` immediately (no reload), then saves to the server and `localStorage` (THEMING-AND-TOKENS.md). A 150ms colour transition on `ground` and `text` only, disabled under reduced motion.

## 21. Toasts and alerts

- Toasts: Sonner via shadcn. Bottom-right on desktop, top on mobile (clear of the bottom nav). `surface`, 1px `line-strong`, `bm-r-lg`, leading icon in the tone colour, text `text`. Durations: success 4s, info 6s; errors do not auto-dismiss. Max 3 visible. Rendered in a polite live region; errors use assertive.
- Toasts never carry the only copy of important information. Anything the user must act on goes into an inline alert.
- Inline alert: full-width block in the content, tone fill (`ok-tint`, `warn-tint`, `bad-tint`, `accent-tint` for info), icon, title and text in `text`, optional action. `role="alert"` only for errors that appear after a user action; otherwise `role="status"`.
- Banners: persistent page-level notices (locked run, acting on behalf, read-only settings) use the inline alert at the top of the content.

## 22. Money and date display

- `Money`: renders `৳ 45,000.00` (symbol, thin space, grouped digits, always 2 decimals) in JetBrains Mono with `font-variant-numeric: tabular-nums`, right-aligned in tables. Input and output values are decimal strings from the API (ADR-0006); the component formats with `Intl.NumberFormat` and never converts to a JS number for arithmetic. Negative amounts show a leading minus and the `bad` colour plus the word "Deduction" in line items (colour never alone).
- Grouping: international (`45,000.00`) in English v1. Bangla locale later may use South Asian grouping (`৳ ৪৫,০০০.০০`); see I18N.md.
- `DateText`, `DateTime`, `Duration`: formats from CONTENT-STYLE.md section 8, always in `Asia/Dhaka` (company setting), wrapped in `<time datetime="...">` with the ISO value.

## 23. Brand components in the app

| Component | App use | Rules |
|---|---|---|
| `DotGrid` | Auth pages, dashboard welcome header, empty states, 404 and error pages | Default 22px pitch; never behind tables, forms or dialogs (APP-UI-ADAPTATION.md section 2) |
| `Glow` | Same places as DotGrid, always placed first | Theme strength from `glow-ink` or `glow-paper`; keep headlines clear of the top-right |
| `Eyebrow` | Dashboard welcome ("BIG-MATRIX SOLUTIONS"), auth card ("HRM") | One per screen |
| `Emphasis` | Not used in the app UI (headline gradient is for marketing); allowed on the sign-in headline only | Max one word |
| `Tick` | StatBar ticks; list dashes in help text | 12px to 20px |
| `Logo` | Top bar, auth pages, payslip PDF (Paper lockup) | Never recoloured; cube mark below 120px width |

## Open questions (owner)

- Overdue threshold for approval items (proposed default: 3 working days).
- Confirm adding `control-border` (section 1.1) to the brand adaptation.
