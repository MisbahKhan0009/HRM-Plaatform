# Design

This folder holds the UX and UI design of the HRM web app: how it is organised, how people move through it, every screen, the component library and the rules for accessibility and copy. Designers and frontend developers build from these files. The brand values come from `docs/02-brand/` and are not repeated here.

| File | Kind | Use it to |
|---|---|---|
| [INFORMATION-ARCHITECTURE.md](INFORMATION-ARCHITECTURE.md) | Normative | Find where a feature lives: sitemap, route map, navigation per role, dashboards, global elements |
| [USER-FLOWS.md](USER-FLOWS.md) | Normative | Build a multi-step task: sign-in, requests, approvals, payroll, documents, offboarding |
| [SCREEN-INVENTORY.md](SCREEN-INVENTORY.md) | Reference | Build a screen: purpose, permissions, data, the one primary action, states, mobile behaviour |
| [COMPONENT-SPECS.md](COMPONENT-SPECS.md) | Normative | Build or review a component: anatomy, variants, states, tokens, accessibility |
| [ACCESSIBILITY.md](ACCESSIBILITY.md) | Normative | Meet WCAG 2.2 AA in both themes; keyboard map; test steps |
| [CONTENT-STYLE.md](CONTENT-STYLE.md) | Normative | Write UI text: terminology, verbs, error messages, confirmations, formats |

## Inputs these files depend on

| Source | Owns |
|---|---|
| `docs/02-brand/APP-UI-ADAPTATION.md` | Ink default theme, Paper toggle, signature elements on brand moments only, status colours |
| `docs/02-brand/source/tokens.json` | Every colour, type, spacing, radius, focus and pattern value |
| `docs/03-architecture/DOMAIN-MODEL.md` | Module names, enums, state machines |
| `docs/03-architecture/SECURITY-MODEL.md` | Roles, permission codenames, scopes, approval rules |
| `docs/03-architecture/MONOREPO.md` | Route folders in `apps/web` and the `packages/ui` layout |
| `docs/05-backend/API-CATALOGUE.md`, `docs/05-backend/API-STANDARDS.md` | Endpoints, list parameters, error codes |

When this folder and a source disagree, the source wins and this folder is the bug.

## Design principles for this app

1. **Dense but calm.** HR and payroll staff work in tables all day. Use the 4px scale, mono labels and tabular figures; keep decoration for brand moments.
2. **One primary action per view.** It is the only Red Fill (`action`) element on screen.
3. **State is always visible.** Every request, run and record shows its status as a badge with a word, never colour alone.
4. **Money and history are never silent.** Financial and destructive actions confirm; history is shown as an immutable timeline.
5. **Mobile first for employees, desktop first for administrators.** Check-in, leave, claims and payslips work one-handed on a phone; payroll and reports are designed for a laptop and remain usable on a tablet.
6. **The server decides.** The UI hides what a user cannot do, but every rule is enforced by the API; the UI shows the API's answer.

## Design tooling

Free only (D-032). Wireframes and specs live in this folder as Markdown and Mermaid. Visual mock-ups, when made, use the Figma free plan or are built directly as pages in `apps/web` against `packages/ui`. The brand source of truth is the owner's Big-Matrix design-system artifact, snapshotted in `docs/02-brand/source/`.
