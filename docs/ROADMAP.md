# HRM Platform — Delivery Roadmap

This is the master sequence for building the HRM platform. Each stage has an
**exit gate**; we do not start the next stage until the gate is met and recorded.

| # | Stage | Key outputs | Exit gate |
|---|---|---|---|
| 0 | **Inception** | Vision, stakeholders, success metrics, constraints | Product owner confirms goals |
| 1 | **Requirements analysis** | Q&A decision log, refined SRS v1.1, policy decisions (leave, attendance, payroll), user stories + acceptance criteria, glossary | All SRS §14 decisions answered or marked "configurable" |
| 2 | **Tech stack selection** | Architecture Decision Records (ADRs) for every major choice | Stack frozen and recorded in ADRs |
| 3 | **AI tooling & skills setup** | Third-party skills installed from GitHub / skills.sh (frontend, backend, design, security, testing), `CLAUDE.md` / agent rules | Skills installed, versions pinned and listed |
| 4 | **Monorepo structure plan** | Folder layout, workspace tooling, package boundaries, naming conventions | Structure approved and scaffolded (empty) |
| 5 | **Documentation** | Architecture, domain model, API standards, DB conventions, security, coding standards (BE/FE), testing strategy, Git workflow, contributing guide, brand & design system, deployment, runbooks, onboarding | Docs reviewed; every developer can onboard from docs alone |
| 6 | **UX / UI design** | Information architecture, user flows, wireframes, design tokens, component library, hi-fi screens, accessibility review | Key flows approved |
| 7 | **Engineering foundation** | Dev containers / Docker Compose, linters, formatters, pre-commit, CI pipelines, environments (local/CI/staging/prod), secrets handling | Green CI on an empty skeleton app |
| 8 | **Development (iterative)** | SRS phases: Foundation → Attendance & Leave → Payroll → Documents & ESS → Reports/Audit | Each phase passes its SRS exit gate |
| 9 | **QA & hardening** | E2E tests, security testing (IDOR, privilege escalation), a11y audit, performance tests, independent payroll verification | SRS §11.2 acceptance criteria pass |
| 10 | **Data migration & UAT** | Import of existing employee data, UAT with HR/Finance, sign-off | Stakeholder sign-off |
| 11 | **Deployment & go-live** | Infrastructure, HTTPS, monitoring, alerts, backups, restore drill, release checklist | Production live, restore drill passed |
| 12 | **Training & handover** | User guides (HR, payroll, employee), admin runbook, support process | Users trained |
| 13 | **Post-launch** | Bug triage, metrics review, P1/P2 backlog prioritization | Ongoing |

## Status

- [x] SRS v1.0 received — `docs/00-requirements/SRS-v1.0.md`

- [x] Stage 1 — Requirements analysis: decisions D-001…D-025 recorded in `docs/00-requirements/DECISION-LOG.md`
- [ ] Stage 2 — Tech stack selection (in progress)
