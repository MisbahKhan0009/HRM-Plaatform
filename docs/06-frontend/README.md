# Frontend

How `apps/web` (React 19 SPA, Vite) and `packages/ui` (design system) are built. Read in this order on your first day: ARCHITECTURE, CODING-STANDARDS, THEMING-AND-TOKENS, then the topic you are working on. The screens, flows and components to build are specified in `docs/04-design/`.

| File | Kind | Use it to |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Normative | Understand routing, guards, data fetching, the API client, auth and error handling, and where code goes |
| [CODING-STANDARDS.md](CODING-STANDARDS.md) | Normative | Write React and TypeScript the way this repo does |
| [THEMING-AND-TOKENS.md](THEMING-AND-TOKENS.md) | Normative | Turn brand tokens into CSS variables and Tailwind classes; Ink default, Paper toggle; fonts |
| [I18N.md](I18N.md) | Normative | Add strings, plurals and formatted dates, numbers and money; stay Bangla-ready |
| [FORMS-AND-VALIDATION.md](FORMS-AND-VALIDATION.md) | Normative | Build forms with shared Zod schemas, map server errors to fields, confirm risky actions |
| [TABLES-AND-LISTS.md](TABLES-AND-LISTS.md) | Normative | Build server-paginated tables, filters in the URL, exports, mobile card lists |

## Stack at a glance

From `docs/01-tech-stack/TECH-STACK.md` and ADR-0005: React 19, Vite, TanStack Router (file routes), TanStack Query, TanStack Table, React Hook Form + Zod (`@hrm/contracts`), shadcn/ui on Radix, Tailwind CSS v4, react-i18next, Lucide icons, Sonner toasts, `pdf-lib` and `exceljs` loaded on demand (`@hrm/documents`). All free and open source (D-032).

## Non-negotiables

1. The UI is never the security boundary. Hiding a button is convenience; the API enforces every permission (SECURITY-MODEL.md section 1).
2. No business rules in the frontend. Leave days, payroll totals, attendance status and balances come from the API (`docs/03-architecture/MONOREPO.md` section 2). Previews call preview endpoints.
3. Money is a decimal string from the API to the screen. Never `Number(amount)` for arithmetic (ADR-0006).
4. Every string is an i18n key (D-003).
5. Every colour, size and radius is a token (THEMING-AND-TOKENS.md).
6. WCAG 2.2 AA in both themes (`docs/04-design/ACCESSIBILITY.md`).

## Relevant installed skills

`vercel-react-best-practices`, `vercel-composition-patterns`, `shadcn`, `tanstack-router-core`, `tanstack-react-router`, `tanstack-router-query`, `vite`, `vitest`, `web-design-guidelines`, `frontend-design`, `playwright-best-practices` (`docs/SKILLS.md`). Where a skill and these docs disagree, these docs win; ignore Next.js-only and server-rendering guidance, since the app is a client-rendered SPA.
