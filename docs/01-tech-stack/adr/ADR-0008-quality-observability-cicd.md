# ADR-0008: Testing, observability and CI/CD

- Status: Accepted (2026-10-22)

## Decision
- **Tests:** Vitest for domain/unit; `@cloudflare/vitest-pool-workers` for API tests in the Workers runtime against a real Postgres; Testing Library for components; Playwright for E2E; axe-core for accessibility. Mandatory suites: permissions/IDOR, state machines, leave ledger concurrency, payroll scenarios (SRS §11.3, independently approved expected values).
- **Observability:** Sentry (frontend + Worker) for errors and alerts; Workers Logs with structured JSON; audit log kept in Postgres, separate from diagnostic logs; health endpoint checks DB via Hyperdrive.
- **CI/CD:** GitHub Actions — lint, typecheck, test, build, migration check on every PR, against a Postgres service container in GitHub Actions (not Neon branches, to save free Neon quota; see ADR-0009); deploy to staging on merge to `main`; production deploy on tagged release with manual approval; migrations run before deploy.
