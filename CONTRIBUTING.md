# Contributing

Thank you for working on the HRM platform. This file is the short version; each rule links to its full document.

## Before you start

- Set up your machine: `docs/09-process/DEVELOPER-ONBOARDING.md`.
- Work only on a story or issue that exists. New scope needs the product owner and a decision-log entry (`docs/00-requirements/DECISION-LOG.md`).
- Never invent HR or payroll policy. If a rule is undecided, ask, and record it under "Open questions (owner)".

## Workflow

1. Branch from `main`: `feat/<area>-<short-name>`, `fix/…`, `docs/…`, `chore/…` (`docs/09-process/GIT-WORKFLOW.md`).
2. Keep the change small: one story, under 300 changed lines where possible (`docs/09-process/PULL-REQUESTS.md`).
3. Write tests with the code. Permission and out-of-scope (404) cases are required for every endpoint.
4. Run `pnpm lint typecheck test` before pushing.
5. Open a PR with a Conventional Commits title (`feat(leave): …`) and fill in the template.
6. Merge after green CI and one approving review (`docs/09-process/CODE-REVIEW.md`). Squash merge only.

## Non-negotiables

- Permissions are enforced on the server for every request (`docs/03-architecture/SECURITY-MODEL.md`).
- Money is `NUMERIC(14,2)` in the database and Decimal in code, never a JavaScript `number`.
- No secrets, personal data or production data in Git, logs or test fixtures.
- No paid services or paid tiers (D-032, ADR-0009).
- Business rules live in `packages/domain` and services, never in routes or React components.
- Every user-visible string goes through i18n; every screen works in both Ink and Paper themes.

## Definition of done

`docs/09-process/DEFINITION-OF-DONE.md`.

## Documentation

Update the owning document in the same PR as the change (`docs/09-process/DOCUMENTATION-GUIDE.md`).

## Security issues

Do not open a public issue. Follow `SECURITY.md`.
