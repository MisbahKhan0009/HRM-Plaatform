# Pull requests

Every change to `main` arrives through a pull request (PR). A PR is small, does one thing, and carries its own tests and doc updates.

## Size limits

| Measure | Target | Hard limit |
|---|---|---|
| Changed lines (excluding generated files, lockfile, migrations' SQL snapshots) | ≤ 300 | 600 |
| Modules touched | 1 | 2, or 3 for a cross-cutting change agreed in advance |
| Purpose | One story or one fix | |

Above the hard limit, split the work: for example, migration and repository first, then service and routes, then UI. Each part must leave `main` releasable.

## Opening a PR

1. Rebase on `main`; run `pnpm lint typecheck test` locally (or `pnpm turbo run lint typecheck test --affected`).
2. Title in Conventional Commits form: `feat(leave): reserve balance for pending requests`. It becomes the squash commit message.
3. Fill in the template (`.github/pull_request_template.md`): what and why, linked story (`US-LEAVE-003`), how it was tested, screenshots in both Ink and Paper themes for UI changes, migration notes, docs updated.
4. Open as **draft** while work is in progress; mark ready when CI is green and the checklist is complete.
5. Request a review. With one developer, the review is an AI-assisted review (below) plus the owner's acceptance for user-visible changes.

## Required checks before merge

- CI green: lint, typecheck, unit and API tests, build, dependency rules, bundle-size budget.
- One approving review (`CODE-REVIEW.md`).
- Every review thread resolved.
- Docs updated where behaviour, API, schema, config or operations changed (`DOCUMENTATION-GUIDE.md`).
- `docs/00-requirements/DECISION-LOG.md` entry if the PR makes or changes a product decision.

## AI-assisted review

When no second developer is available, run these installed skills on the PR diff and attach the summary to the PR:

- `security-review` (getsentry) on every PR.
- `differential-review` (trailofbits) on PRs touching `accounts`, `payroll`, `documents`, permissions or migrations.
- `gha-security-review` on PRs touching `.github/workflows/`.
- `web-design-guidelines` on PRs touching `apps/web` or `packages/ui`.

An AI review never replaces the checklist; the author still answers every item.

## After merge

- The branch is deleted automatically.
- Watch the staging deploy; if it fails, fix forward within the hour or revert the squash commit.
- Close the linked issue with a reference to the PR.
