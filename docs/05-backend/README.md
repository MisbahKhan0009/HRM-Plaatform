# Backend documentation

The backend is one Cloudflare Worker (`apps/api`): a Hono API under `/api/v1`, a scheduled handler for background jobs, and static hosting of the React app. Business rules live in `packages/domain`, the schema in `packages/db`. Architecture and canonical models are in `docs/03-architecture/`.

| Document | Kind | Read it when you |
|---|---|---|
| [CODING-STANDARDS.md](CODING-STANDARDS.md) | normative | write any backend code |
| [MODULE-GUIDE.md](MODULE-GUIDE.md) | runbook | add an endpoint or a module |
| [API-STANDARDS.md](API-STANDARDS.md) | normative | design an endpoint: URLs, errors, pagination, idempotency, error code catalogue |
| [API-CATALOGUE.md](API-CATALOGUE.md) | reference | need the list of endpoints with permissions and transitions |
| [BUSINESS-RULES.md](BUSINESS-RULES.md) | normative | implement attendance, leave, payroll, codes, settings |
| [DATABASE-CONVENTIONS.md](DATABASE-CONVENTIONS.md) | normative | change the schema, write queries, handle transactions |
| [AUTH-IMPLEMENTATION.md](AUTH-IMPLEMENTATION.md) | normative | touch sign-in, sessions, MFA, invitations, `/auth/me` |
| [AUDIT.md](AUDIT.md) | normative | change anything sensitive (every such change is audited) |
| [JOBS-AND-OUTBOX.md](JOBS-AND-OUTBOX.md) | normative | send email or add scheduled work |
| [EMAIL.md](EMAIL.md) | normative | add or change an email template |

Related: `docs/03-architecture/DATA-MODEL.md` (every table), `docs/03-architecture/SECURITY-MODEL.md` (roles and permissions), `docs/07-quality/TESTING-STRATEGY.md` (how backend code is tested), `docs/08-operations/` (environments, secrets, deployment).

Precedence when documents disagree: decision log, then `docs/03-architecture/` canonical documents, then this folder. Report a conflict instead of choosing silently.
