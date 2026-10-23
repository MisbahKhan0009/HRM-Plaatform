# Accessibility

The HRM targets **WCAG 2.2 level AA in both themes** (SRS 4.1, NFR-UX-004). This file turns that target into rules for this app, a keyboard map, screen-reader patterns and the test procedure. A feature is not done until it passes section 7 (definition of done lives in `docs/09-process/`).

## 1. Checklist applied to this app

| WCAG 2.2 criterion | How this app meets it |
|---|---|
| 1.1.1 Non-text content | Icon-only buttons have `aria-label`; decorative icons and DotGrid/Glow have `aria-hidden="true"`; logo `alt="Big-Matrix Solutions"`; receipts and documents are files, not images in the page |
| 1.3.1 Info and relationships | Real `<table>` with `<th scope>` for data; `<label for>` on every control; fieldsets with legends for radio groups (leave unit, theme); headings in order (one `h1` per page) |
| 1.3.2 Meaningful sequence | DOM order matches visual order; the primary action is last in dialog footers both in DOM and visually on desktop |
| 1.3.5 Identify input purpose | `autocomplete` on email (`email`), name fields, phone (`tel`), OTP (`one-time-code`) |
| 1.4.1 Use of colour | Every status badge has a word (COMPONENT-SPECS.md section 10); calendar leave bars carry text; negative money shows "Deduction" |
| 1.4.3 Contrast (minimum) | All text pairs at least 4.5:1 (section 3). Matrix Red (`bm-accent`) is never used for small text on Paper (4.09:1) |
| 1.4.4 Resize text / 1.4.10 Reflow | Layout works at 200% zoom and at 320 CSS px width with no two-direction scroll; tables scroll inside their container or switch to cards |
| 1.4.11 Non-text contrast | Control edges use `control-border` (at least 3.53:1); focus ring `accent` at least 3.9:1; icons used as the only cue have at least 3:1 |
| 1.4.12 Text spacing | No fixed-height text containers; badges and buttons grow |
| 1.4.13 Content on hover or focus | Tooltips dismiss with Escape, stay while hovered, and never hold required information |
| 2.1.1 Keyboard / 2.1.2 No trap | Every action is reachable by keyboard; dialogs trap focus only while open and release on close |
| 2.4.1 Bypass blocks | "Skip to content" link as the first focusable element |
| 2.4.2 Page titled | `<title>` = "<Page title> · HRM · Big-Matrix" updated on route change |
| 2.4.3 Focus order / 2.4.7 Focus visible | Focus order follows layout; visible `accent` outline (`focus-width`, `focus-offset`) on `:focus-visible` |
| 2.4.11 Focus not obscured (minimum) | Sticky top bar, sticky table header and mobile bottom bar use `scroll-padding` so focused elements are never hidden |
| 2.5.7 Dragging movements | File upload has a browse button; no drag-only interactions (calendar ranges are click-click) |
| 2.5.8 Target size (minimum) | Targets at least 24 × 24px; mobile primary targets 44px or more |
| 3.1.1 Language of page | `<html lang="en">` (switches to `bn` when Bangla ships) |
| 3.2.2 On input | Changing a filter updates results but never moves focus or navigates; selects never submit on change |
| 3.3.1 Error identification / 3.3.3 Error suggestion | Field errors in text next to the field, with a fix ("Enter a date on or after 1 Nov 2026") |
| 3.3.4 Error prevention (legal, financial) | Payroll and payment actions confirm with a summary; lock uses typed confirmation (COMPONENT-SPECS.md section 12) |
| 3.3.7 Redundant entry | Forms prefill known values (employee data, previous claim category); multi-step import keeps mapped columns when going back |
| 3.3.8 Accessible authentication (minimum) | Passkeys and email codes need no memorised password; OTP fields allow paste and autofill; no CAPTCHA |
| 4.1.2 Name, role, value | Radix primitives provide roles and states; custom widgets set `aria-expanded`, `aria-selected`, `aria-sort` |
| 4.1.3 Status messages | Toasts and save confirmations in live regions (section 5) |

## 2. Themes

Both themes are tested separately; a pass in Ink does not imply a pass in Paper. Ink is the default (D-040). The OS `prefers-color-scheme` is not used, but `prefers-reduced-motion` and `forced-colors` are honoured:

- **Reduced motion**: disables shimmer, theme transition, toast slide-in and dialog zoom.
- **Forced colors (Windows high contrast)**: badges, focus rings and the active nav item keep a visible border (`border: 1px solid CanvasText` fallback); icons use `currentColor`.

## 3. Contrast table

Measured with the WCAG relative-luminance formula against the token values in `docs/02-brand/source/tokens.json`. "OK for" lists the permitted use.

| Foreground | Ink: on `ground` / `surface` / `ground-2` | Paper: on `ground` / `ground-2` | OK for |
|---|---|---|---|
| `text` | 16.99 / 14.77 / 16.45 | 17.04 / 16.33 | All text |
| `text-2` | 9.91 / 8.61 / 9.59 | 8.32 / 7.97 | All text |
| `text-3` | 6.10 / 5.30 / 5.91 | 5.25 / 5.03 | All text, used for labels and captions |
| `link` | 7.81 / 6.79 / 7.56 | 7.31 / 7.00 | Links and text buttons |
| `accent` | 6.19 / 5.38 / 6.00 | 4.09 / 3.92 | Ink: text; Paper: marks, ticks, focus ring only (not body text) |
| `ok` | 10.22 / 8.89 / 9.90 | 5.33 / 5.11 | Text and icons |
| `bad` | 7.81 / 6.79 / 7.56 | 6.57 / 6.30 | Text and icons |
| `warn` | 10.27 / 8.93 / 9.95 | 6.33 / 6.06 | Text and icons |
| `control-border` | 4.06 / 3.53 / 3.93 | 3.69 / 3.54 | Control edges (3:1 needed) |
| `on-action` on `action` | 4.83 (both themes) | | Primary button label |

Badge pairs (text on tint): `warn`/`warn-tint` 8.55 (Ink), 5.90 (Paper); `ok`/`ok-tint` 8.55, 4.71; `bad`/`bad-tint` 7.04, 5.75; `accent-text`/`accent-tint` 5.58, 5.21; `text-2`/`ground-2` 9.59, 7.97.

`line` and `line-strong` are below 3:1 and are used only for decorative separation, never as the only boundary of a control.

## 4. Keyboard map

| Context | Keys | Action |
|---|---|---|
| Any page | `Tab` / `Shift+Tab` | Move focus |
| Any page | `Enter` on "Skip to content" | Jump to `<main>` |
| Global | `/` | Focus the page's search field, when the page has one (ignored while typing in a field) |
| Global | `g` then `d` / `a` / `l` / `i` | Go to Dashboard / Attendance / Leave / Approvals (ignored in fields; listed in the user menu "Keyboard shortcuts") |
| Sidebar, menus | `↑` `↓`, `Home`, `End`, `Enter`, `Esc` | Move, open, close (Radix) |
| Dialog | `Esc` | Cancel and close; focus returns to the trigger |
| Tabs | `←` `→` | Switch tab (automatic activation) |
| Table header | `Enter` / `Space` on a sortable header | Cycle sort: ascending, descending, none |
| Table rows | `Tab` to the first-cell link, `Enter` | Open record |
| Date picker | arrows (day), `PageUp`/`PageDown` (month), `Home`/`End` (week start/end), `Enter` | Select |
| Combobox | type to search, `↑` `↓`, `Enter`, `Esc` | Select |
| Code input | type or paste digits | Fills; submits automatically when 6 digits are pasted |

Single-key shortcuts can be turned off in `/me/preferences` (WCAG 2.1.4).

## 5. Screen-reader patterns

| Pattern | Implementation |
|---|---|
| Route change | Move focus to the page `h1` (with `tabindex="-1"`) and announce the new title through a polite live region |
| Tables | `<caption>` (visually hidden when the page title already names it) with the result count ("132 employees, sorted by name"); sortable headers expose `aria-sort`; row actions have labels that include the row ("Approve leave request LV-000123") |
| Forms | Error summary at the top after a failed submit (`role="alert"`, links to each field), focus moves to the summary; each field has `aria-invalid` and `aria-describedby` for hint and error |
| Toasts | Sonner region with `aria-live="polite"`; error toasts `assertive`; toasts do not steal focus |
| Loading | `aria-busy="true"` on the region; visually hidden "Loading <thing>" |
| Status badges | Plain text inside; no `role` needed; icon `aria-hidden` |
| Money | Rendered as text with the currency symbol; a visually hidden "Bangladeshi taka" is not added (the symbol is read as "taka" by major screen readers; verify in testing) |
| Timelines | `<ol>` with `<time datetime>`; the latest entry first |
| Approval actions | After approve or reject, focus moves to the next item in the inbox, or to the inbox heading if none remain, and the result is announced |
| Check-in | After success, the panel's status text is announced ("Checked in at 09:12") |

## 6. Mobile

- Content readable at 320px width; no horizontal page scroll.
- Touch targets 44px for primary actions and bottom navigation; 8px minimum spacing between adjacent targets.
- Orientation is not locked.
- Bottom sheets have a visible close button in addition to swipe.

## 7. Testing procedure

Every pull request that changes UI:

1. **Automated**: axe-core checks in Playwright on each touched route, in both themes (`data-theme="ink"` and `"paper"`); zero serious or critical violations allowed. Component stories or tests run `vitest-axe` where present. See `docs/07-quality/` for the CI wiring.
2. **Keyboard pass**: complete the changed flow without a mouse; confirm visible focus at each step and no trap.
3. **Zoom pass**: 200% browser zoom and a 320px-wide viewport.
4. **Screen reader spot check** for new patterns: NVDA + Firefox on Windows or VoiceOver + Safari on macOS/iOS (both free).
5. **Contrast**: any new colour pair is measured and added to section 3 before merge.

Before release: a full manual audit of the core flows in USER-FLOWS.md (sign-in, check-in, leave request and approval, claim, payroll run, payslip download) using the installed `web-design-guidelines` skill and the design-skills accessibility audit.

## Open questions (owner)

- None for policy. Bangla screen-reader support will be verified when Bangla ships (D-003).
