# App UI adaptation of the Big-Matrix brand

Status: **Approved** by owner, 2026-10-22 (D-040). Source brand: `source/brand-book.md`, `source/tokens.json`.

The brand book is written for marketing pieces. The HRM is a product that people use all day for dense tables and forms. This document records the changes we make for the app. Anything not listed here follows the brand book exactly.

## 1. Themes
- **Ink (dark) is the default theme.** Users can switch to **Paper (light)** with a toggle in the top bar and on their profile page.
- Precedence: the user's saved preference (stored on the server, so it follows them across devices), then the last choice cached in `localStorage`, then Ink. The OS `prefers-color-scheme` setting is **not** used, because the brand default is Ink.
- Implementation: set `data-theme="ink"` or `data-theme="paper"` on `<html>` before first paint to avoid a flash. Use the brand's role tokens (`ground`, `surface`, `text`, `line`, `accent`, `action` …) and never raw `bm-*` hex values in components.

## 2. Signature elements (dot grid + red glow)
Use them only on **brand moments**: the sign-in and account-recovery screens, the dashboard welcome header, empty states, and the 404/error pages. They are **not** shown behind tables, forms, dialogs or reports, where they would hurt legibility.

## 3. Kept from the brand
- Red only as the accent; **one primary button per view** (`action`, Red Fill).
- Fonts: Inter (body/UI), Inter Tight 600 (page titles, KPI numbers), JetBrains Mono (labels, IDs such as `EMP-0001`, amounts in tables, with tabular figures).
- Mono caps `label` style for table headers, field labels in dense views, and badges.
- 4px spacing scale; radii `bm-r` (6px) for controls and `bm-r-lg` (10px) for cards; no drop shadows except `shadow-primary`.
- Keyboard focus: `accent` outline with `focus-width` and `focus-offset` on every interactive element.
- Lists use the 8×2px accent dash. Icons are outline style; **Lucide** (free, shadcn default) replaces Bootstrap Icons in the app. Stroke and size follow the `icon-*` tokens.
- Voice: precise, calm, plain. Sentence case. Verb-first buttons ("Approve leave", "Run payroll").

## 4. Additions for product UI
Status colours. The brand has `ok`/`bad`. The app adds **warning** (pending, expiring, needs attention), and uses the existing `accent-tint` for **info** (the brand book already assigns `accent-tint` to info badges). Blue stays logo-only.

| Token | Ink | Paper | Contrast | Use |
|---|---|---|---|---|
| `warn` | #F2B34B | #8A5300 | 10.27:1 on Ink · 6.33:1 on Paper | Pending, expiring, attention |
| `warn-tint` | #2A2112 | #FFF6E5 | warn text on tint: 8.55:1 · 5.90:1 | Warning badge/background |
| `ok` / `bad` | brand values | brand values | 10.22 / 7.81 on Ink · 5.33 / 6.57 on Paper | Approved/paid · rejected/error |

| `control-border` | #70747B | #858585 | ≥ 3.5:1 on `ground`/`surface` in both themes (WCAG 1.4.11) | Input, select and checkbox borders. Brand `line`/`line-strong` are too faint for controls |

Status is **never colour alone** (NFR-UX-003): every badge has a word, and an icon where space allows.

Standard status mapping: Draft = neutral (`text-2` on `ground-2`) · Pending/Submitted = `warn` · Approved/Active/Paid = `ok` · Rejected/Failed/Separated = `bad` · Locked/Archived = neutral + lock icon · Info = `accent-tint`.

## 5. Accessibility
Target WCAG 2.2 AA in both themes. `line` and `line-strong` are below 3:1, so inputs get a visible label and a fill (`ground-2`) as well as a border. Never put white text on Matrix Red (`bm-accent`) at body size.

Detailed component specs (tables, forms, dialogs, navigation, data display) are written in Stage 5/6: `docs/04-design/`.
