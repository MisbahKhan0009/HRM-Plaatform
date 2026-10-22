# Documentation guide

Every fact lives in one document; everything else links to it. This guide says where each kind of document lives, how decisions are recorded, and when a code change must update a document.

## Where things live

| Kind of content | Location | Kind |
|---|---|---|
| Original requirements | `docs/00-requirements/SRS-v1.0.md` | Historical, never edited |
| Requirement changes | `docs/00-requirements/SRS-v1.1-CHANGES.md` | Normative |
| Product decisions | `docs/00-requirements/DECISION-LOG.md` | Historical, append-only |
| Scope, stories, glossary, risks | `docs/00-requirements/` | Normative / reference |
| Technology choices | `docs/01-tech-stack/TECH-STACK.md`, `adr/ADR-NNNN-*.md` | Normative / historical |
| Brand and app UI adaptation | `docs/02-brand/` (`source/` is a synced snapshot, never hand-edited) | Normative |
| Architecture, domain, data, security | `docs/03-architecture/` | Normative |
| UX and design specs | `docs/04-design/` | Normative |
| Backend standards and references | `docs/05-backend/` | Normative / reference |
| Frontend standards | `docs/06-frontend/` | Normative |
| Testing and security testing | `docs/07-quality/` | Normative |
| Environments, deploys, backups, runbooks | `docs/08-operations/` | Runbook |
| Ways of working | `docs/09-process/` | Normative |
| End-user guides | `docs/10-user-guides/` | Descriptive |
| AI agent rules | `AGENTS.md` | Normative |
| Agent skills inventory | `docs/SKILLS.md` | Reference |
| Delivery status | `docs/ROADMAP.md` | Descriptive |
| API reference | Generated OpenAPI from the code; `docs/05-backend/API-CATALOGUE.md` routes to it | Reference |

The index of all documents is `docs/README.md`. Add every new document to it.

## Recording a product decision

A product decision changes what the system does or how it behaves for users: a policy, a scope change, a role change.

1. Add a row to `docs/00-requirements/DECISION-LOG.md` with the next `D-NNN` ID, topic, decision, impact and date.
2. Never edit or delete an existing row. To change a decision, add a new row and mark the old one "superseded by D-NNN" (a strike-through of the old wording with a pointer is the existing convention, see D-006).
3. Update `SRS-v1.1-CHANGES.md` if a requirement changes.
4. Reference the ID in the PR description and, where it explains non-obvious code, in a code comment (`// D-022: calendar-day proration`).

Load the `recording-decisions` skill when writing one.

## Recording a technical decision (ADR)

Write an ADR when a choice is costly to reverse: a new dependency with lock-in, a change to the data store, auth, hosting, or a cross-cutting pattern.

1. Copy the structure of an existing ADR: title, status, context, decision, consequences.
2. Number it with the next free `ADR-NNNN` and a kebab-case slug.
3. Status starts as `Proposed`; the lead or owner moves it to `Accepted`.
4. An accepted ADR is not rewritten. A later change is a new ADR with `Supersedes: ADR-NNNN`, and the old ADR's status line changes to `Superseded by ADR-NNNN`.
5. Add it to the table in `docs/01-tech-stack/TECH-STACK.md` if it changes the stack.

## Keeping docs in sync with code

| You changed | Update |
|---|---|
| An endpoint, request or response | Route schema (OpenAPI is generated); `docs/05-backend/API-CATALOGUE.md` if an endpoint is added or removed |
| A table, column, constraint or index | `docs/03-architecture/DATA-MODEL.md` |
| An enum value or state transition | `docs/03-architecture/DOMAIN-MODEL.md` (needs a decision-log entry) |
| A permission or role grant | `docs/03-architecture/SECURITY-MODEL.md` (needs a decision-log entry) |
| A calculation or business rule | `docs/05-backend/BUSINESS-RULES.md` and the matching tests |
| An environment variable, secret or binding | `docs/08-operations/ENVIRONMENTS.md`, `SECRETS.md`, `.dev.vars.example` |
| A job or schedule | `docs/03-architecture/ARCHITECTURE.md` §4 and `docs/05-backend/JOBS-AND-OUTBOX.md` |
| A deploy or recovery step | The runbook in `docs/08-operations/`, after running the step |
| A user-visible workflow | The user guide outline in `docs/10-user-guides/` |
| Brand tokens | Re-sync `docs/02-brand/source/` from the owner's design-system artifact, then regenerate `packages/ui/tokens` |

The PR template asks which documents changed. A reviewer blocks a PR that changes behaviour without its document.

## Writing style

- Load the `technical-writing` skill for any document, plus the type skill: `writing-design-docs`, `writing-runbooks`, `documenting-contracts` or `recording-decisions`.
- Conclusion first; sentence-case headings; plain English; short sentences.
- No em or en dashes; no "last updated" lines or changelog sections inside documents (Git keeps history).
- State only what you can trace to code, a decision, or a source. If something is undecided, list it under "Open questions (owner)".
- Normative documents state the rule; when code violates the rule, fix the code or record a decision, never quietly weaken the rule.
- Runbook steps must have been run at least once before they are published as final.
