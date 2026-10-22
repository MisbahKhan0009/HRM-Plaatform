## What and why

<!-- One or two sentences. Link the story: US-LEAVE-003. Link the decision if any: D-016. -->

## How it was tested

<!-- Commands run, new tests, manual steps on staging or local. -->

## Checklist

- [ ] Title follows Conventional Commits: `type(scope): summary`
- [ ] Acceptance criteria of the linked story pass, including negative and permission cases
- [ ] Endpoints: success, validation, unauthorized role and out-of-scope (404) tests
- [ ] Permission and scope checked on the server; employee taken from the session for self-service
- [ ] No secrets, OTPs, tokens or personal data in code, logs, audit metadata or fixtures
- [ ] Money uses Decimal and `NUMERIC(14,2)`; dates follow UTC / `Asia/Dhaka` rules
- [ ] Migration reviewed as SQL; no migration already on `main` edited (or: no migration)
- [ ] UI: i18n keys only, role tokens only, checked in Ink and Paper, keyboard accessible, no colour-only status (or: no UI)
- [ ] No paid service or tier; no CPU-heavy work added to the Worker
- [ ] Documents updated (list below) or not needed

## Documents updated

<!-- e.g. docs/05-backend/API-CATALOGUE.md, docs/03-architecture/DATA-MODEL.md -->

## Screenshots (UI changes)

<!-- Ink and Paper, desktop and 360 px width for self-service screens. -->

## Migration and deploy notes

<!-- Anything ops must do: new secret, new setting, data backfill. -->
