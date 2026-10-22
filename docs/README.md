# Documentation index

Start here. Read the documents in this order when you join the project:

1. `ROADMAP.md`: delivery stages and current status
2. `00-requirements/`: what we're building and why
3. `03-architecture/ARCHITECTURE.md`, `DOMAIN-MODEL.md`, `SECURITY-MODEL.md`: the canonical design
4. The section for your role: backend (`05`), frontend (`06`), design (`04`), QA (`07`), operations (`08`)
5. `09-process/`: how we work
6. `../AGENTS.md`: rules for AI coding agents (humans should read it too)

| Section | Contents |
|---|---|
| [`00-requirements/`](00-requirements/) | SRS v1.0, decision log (D-xxx), SRS v1.1 changes, v1 scope, user stories, glossary, risk register |
| [`01-tech-stack/`](01-tech-stack/) | Frozen stack and ADRs (incl. ADR-0009 zero-cost guardrails) |
| [`02-brand/`](02-brand/) | Big-Matrix brand source snapshot and app UI adaptation |
| [`03-architecture/`](03-architecture/) | Architecture, monorepo, domain model, data model, security model |
| [`04-design/`](04-design/) | Information architecture, user flows, screen inventory, component specs, accessibility, content style |
| [`05-backend/`](05-backend/) | Coding standards, API standards and catalogue, DB conventions, business rules, auth, audit, jobs, email, module guide |
| [`06-frontend/`](06-frontend/) | Coding standards, frontend architecture, theming/tokens, i18n, forms, tables |
| [`07-quality/`](07-quality/) | Testing strategy, payroll test cases, security testing, threat model, performance budgets |
| [`08-operations/`](08-operations/) | Environments, account setup, secrets, CI/CD, deployment, backup/restore, observability, free-tier monitoring, incident runbooks, go-live checklist |
| [`09-process/`](09-process/) | Git workflow, PRs, code review, definition of done, onboarding, documentation guide |
| [`10-user-guides/`](10-user-guides/) | End-user guides (Stage 12) |
| [`SKILLS.md`](SKILLS.md) | Installed AI agent skills |

## Source-of-truth rules

- **Decisions** live in `00-requirements/DECISION-LOG.md` (D-xxx) and ADRs. Code comments reference them (`// D-022 calendar-day proration`).
- **Names** (modules, enums, states, roles, permissions) come only from `03-architecture/DOMAIN-MODEL.md` and `SECURITY-MODEL.md`.
- **Brand** values come only from `02-brand/source/tokens.json` (via the generated tokens), never typed by hand.
- If two documents disagree, the canonical document wins and the other is fixed in the same PR.
