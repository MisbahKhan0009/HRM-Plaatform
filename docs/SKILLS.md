# AI Agent Skills

Third-party skills installed for AI-assisted development (Claude Code and other agents).
All are **free and open source**, installed from GitHub via the [skills.sh](https://skills.sh) CLI, except the TanStack Router skills, which were copied from the TanStack repo by hand because the CLI can't discover them.
We write no skills of our own.

- Location: `.claude/skills/<name>/` (copied, committed, so every developer and CI agent gets the same set)
- Lockfile: `skills-lock.json` (source + content hash per skill)
- Install / restore: `npx skills experimental_install`
- Update: `npx skills update -p`, then **review the diff** before committing (skills run with full agent permissions)
- Review rule: every new or updated skill is read before it is committed; scripts are checked for network calls, secrets access and destructive commands.

## Inventory (reviewed 2026-10-22)

| Area | Skill | Source repo @ commit | License | Use it for |
|---|---|---|---|---|
| Frontend | `vercel-react-best-practices` | vercel-labs/agent-skills @ 063bee9 | MIT | React performance & patterns (ignore Next.js-only rules) |
| Frontend | `vercel-composition-patterns` | vercel-labs/agent-skills | MIT | Component API design, compound components |
| Frontend / UX | `web-design-guidelines` | vercel-labs/agent-skills | MIT | UI review: accessibility, forms, interaction |
| Frontend | `shadcn` | shadcn-ui/ui @ 3d98900 | MIT | Adding/theming shadcn/ui components, applying our brand tokens |
| Frontend | `tanstack-react-router`, `tanstack-router-core` (+ sub-guides: auth-and-guards, data-loading, search-params, type-safety …), `tanstack-router-query` | tanstack/router @ 6b9fe6d (manual copy) | MIT | Routing, guards, loaders, Router + Query integration |
| Frontend / Design | `frontend-design` | anthropics/skills @ dbd4588 | Apache-2.0 | Visual quality of new screens |
| Build | `vite`, `vitest`, `pnpm` | antfu/skills @ feb0f3a | MIT | Vite config, unit tests, pnpm workspaces |
| Monorepo | `turborepo` | vercel/turborepo @ 8003ff0 | MIT | Pipelines, caching, package boundaries |
| Backend | `hono` | honojs/skills @ e54ce51 | MIT | Hono routing, middleware, validation, testing |
| Platform | `cloudflare`, `wrangler`, `workers-best-practices`, `web-perf` | cloudflare/skills @ 86505e4 | Apache-2.0 | Workers, bindings, R2, Hyperdrive, Cron, deploys, performance |
| Auth | `better-auth-best-practices`, `better-auth-security-best-practices`, `two-factor-authentication-best-practices` | better-auth/skills @ 20c9e88 | public, no license file | Better Auth setup, hardening, TOTP |
| Database | `neon-postgres` | neondatabase/agent-skills @ d814689 | Apache-2.0 | Neon connections, branching, restore |
| Database | `supabase-postgres-best-practices` | supabase/agent-skills @ c9be0e9 | MIT | Generic Postgres schema/index/migration rules (ignore Supabase-only parts such as RLS-via-Supabase-Auth) |
| Security | `security-review`, `gha-security-review` | getsentry/skills @ f57ada2 | Apache-2.0 | Code security review, GitHub Actions hardening |
| Security | `sharp-edges`, `differential-review`, `supply-chain-risk-auditor`, `semgrep` | trailofbits/skills @ 1e0cb77 | CC-BY-SA-4.0 | Footgun review, PR security diff review, dependency risk, static analysis (**Semgrep OSS only — never Semgrep Pro/AppSec Platform**) |
| Security | `security-and-hardening` | addyosmani/agent-skills @ aeac41d | MIT | OWASP Top 10 hardening, privacy |
| Testing | `property-based-testing` | trailofbits/skills | CC-BY-SA-4.0 | Payroll/leave arithmetic invariants with fast-check |
| Testing | `test-driven-development` | addyosmani/agent-skills | MIT | Red-green-refactor workflow |
| Testing | `playwright-best-practices` | currents-dev/playwright-best-practices-skill @ 283d5cb | MIT | E2E, a11y (axe), auth fixtures (Currents cloud features are paid — not used) |
| Engineering | `api-and-interface-design`, `ci-cd-and-automation`, `observability-and-instrumentation` | addyosmani/agent-skills | MIT | API contracts, CI pipelines, logging/alerts |
| Docs | `technical-writing`, `writing-design-docs`, `recording-decisions`, `writing-runbooks`, `documenting-contracts` | riekelt/technical-writer @ 85e5372 | MIT | All repository documentation, ADRs, runbooks, API reference |
| Docs | `doc-coauthoring` | anthropics/skills | Apache-2.0 | Long-form docs with stakeholders |
| Docs | `agents-md` | getsentry/skills | Apache-2.0 | Maintaining `AGENTS.md` / `CLAUDE.md` |

## Free-only rule (D-032)
Some skills mention paid products (Semgrep Pro, Currents cloud, Neon paid tiers, Vercel deploys, Supabase hosting). **Never adopt a paid feature a skill suggests.** Where a skill and `docs/01-tech-stack/` disagree, the tech-stack docs win.

## Skills considered and not installed
- `yusukebe/hono-skill`: archived; replaced by `honojs/skills`.
- `better-auth emailAndPassword`: we are passwordless (D-033).
- Vercel deploy/CLI and Supabase platform skills: not our hosting.
