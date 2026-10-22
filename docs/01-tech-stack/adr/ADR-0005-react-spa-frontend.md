# ADR-0005: React SPA (Vite) + TanStack + shadcn/ui

- Status: Accepted (2026-10-22)
- Supersedes: SRS §2.3 / §10.3 frontend choice (Nuxt/Vue)

## Decision
React 19 SPA built by Vite, served as static assets by the API Worker. TanStack Router (type-safe file-based routes, route guards by capability from `/auth/me`), TanStack Query (server state), TanStack Table (lists), React Hook Form + Zod (shared schemas), shadcn/ui + Tailwind v4 (accessible Radix primitives, tokens as CSS variables), react-i18next (D-003).

## Rationale
Internal, authenticated app: no SEO, SSR adds complexity without benefit. Same-origin hosting simplifies secure cookie auth. Largest ecosystem and AI-tooling support for a small team.

## Consequences
+ Fast, simple deploys; shared TypeScript types with the API.
− UI must never be the security boundary: hiding buttons is UX only; the API enforces every permission (SRS §6.2).
