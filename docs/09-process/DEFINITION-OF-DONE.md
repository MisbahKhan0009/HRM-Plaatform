# Definition of done

A user story is done when every item below is true. "Done" means deployed to staging and accepted, not "merged".

## Per story

1. **Acceptance criteria met.** Every Given/When/Then in `docs/00-requirements/USER-STORIES.md` for the story passes, including the negative and permission cases.
2. **Tests.**
   - Domain rules: unit tests (property-based for arithmetic on money or leave).
   - Endpoints: API tests for success, validation error, unauthorized role and out-of-scope record (404).
   - UI: component tests for form states (loading, empty, error, success).
   - Critical flows listed in `docs/07-quality/TESTING-STRATEGY.md` have a Playwright test.
3. **Security.** Permission and scope enforced on the server; audit entries written for sensitive actions; no personal data in logs.
4. **Data.** Migrations reviewed and applied on staging; seed data updated if the story needs it.
5. **UI.** Uses `packages/ui` components and role tokens; checked in Ink and Paper; keyboard accessible; no colour-only status; works on a 360 px wide screen for self-service screens; all strings are i18n keys.
6. **API contract.** OpenAPI output reflects the endpoints; error responses use stable codes.
7. **Docs.** Owning documents updated (API catalogue, business rules, data model, user guide outline) per `DOCUMENTATION-GUIDE.md`.
8. **Review.** PR approved and merged per `PULL-REQUESTS.md`.
9. **Deployed.** Running on staging without new Sentry errors.
10. **Accepted.** The product owner (or delegate) has tried it on staging and accepted it.
11. **Free.** No new paid service; Worker bundle within budget (ADR-0009).

## Per phase (delivery plan in `docs/00-requirements/SCOPE-V1.md`)

- Every story in the phase is done.
- The phase exit gate passes.
- `docs/00-requirements/RISK-REGISTER.md` reviewed.
- A demo on staging for the owner.

## Per release

- Every item in `docs/08-operations/GO-LIVE-CHECKLIST.md` (first release) or the deployment checklist in `docs/08-operations/DEPLOYMENT.md` passes.
- Release notes written from the squash commit messages.
