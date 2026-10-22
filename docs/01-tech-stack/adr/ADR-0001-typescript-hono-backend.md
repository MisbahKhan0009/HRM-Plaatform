# ADR-0001: TypeScript + Hono backend instead of Django

- Status: Accepted (2026-10-22)
- Supersedes: SRS §2.3 / §10.1 backend choice (Python, Django, DRF)

## Context
D-024 requires frontend and backend on Cloudflare Workers. Django needs a long-running WSGI/ASGI process and synchronous Postgres drivers; it does not run on Workers. Python Workers (Pyodide) support only a subset of packages and are not production-proven for Django.

## Decision
Use TypeScript with **Hono** on Workers, **Zod** for validation and `@hono/zod-openapi` so routes, request/response validation and the OpenAPI spec come from one definition (satisfies SRS §4.2, NFR-MNT-004).
SRS architecture principles are kept: modular monolith, domain modules (`accounts`, `organization`, `employees`, `attendance`, `leave`, `payroll`, `reimbursements`, `documents`, `workflows`, `notifications`, `reports`, `audit`), business rules in a service/domain layer — never in route handlers or React components (NFR-MNT-002).

## Consequences
+ One language across the monorepo; shared types and Zod contracts between API and UI.
+ Native fit for Workers (fast cold starts, first-class bindings).
− No Django admin; an internal admin UI must be built for settings/roles.
− Team must follow documented layering conventions strictly (no framework enforcement).
