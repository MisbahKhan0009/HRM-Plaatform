# Adding a module or endpoint

Status: **Accepted**, 2026-10-22. Runbook for developers. Follows the layering in `docs/03-architecture/ARCHITECTURE.md` section 3 and the file layout in `docs/03-architecture/MONOREPO.md` section 3. The example adds the reimbursement claim **approve** endpoint end to end; a new module follows the same steps with more files.

## 1. Checklist

1. The endpoint is in `API-CATALOGUE.md` (add it there first if it is new, in the same PR).
2. Contracts: input/output schemas, permission constant, error codes in `packages/contracts`.
3. Domain: pure rule or transition function in `packages/domain`, with tests.
4. Repository: queries in `<module>.repository.ts`.
5. Policy: permission and scope check in `<module>.policy.ts`.
6. Service: transaction, policy, domain, repository, audit, outbox.
7. Route: OpenAPI route definition calling the service.
8. Tests: service tests (success, each error code, each scope, IDOR) and an API test.
9. Regenerate `apps/api/openapi.json`; update `AUDIT.md` if a new audit action was added.
10. Run `pnpm turbo run lint typecheck test --affected` before pushing.

## 2. Contracts (`packages/contracts`)

```ts
// packages/contracts/src/reimbursements.ts
import { z } from '@hono/zod-openapi';
import { MoneySchema, IsoDateSchema, UuidSchema } from './common';

export const ReimbursementClaimStatusSchema = z.enum(['draft', 'submitted', 'approved', 'rejected', 'withdrawn', 'included', 'paid']);

export const ReimbursementClaimDtoSchema = z.object({
  id: UuidSchema,
  claimNumber: z.string(),
  employeeId: UuidSchema,
  category: z.literal('transport'),
  expenseDate: IsoDateSchema,
  amount: MoneySchema,
  description: z.string(),
  status: ReimbursementClaimStatusSchema,
  decisionComment: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi('ReimbursementClaim');
export type ReimbursementClaimDto = z.infer<typeof ReimbursementClaimDtoSchema>;

export const DecideClaimInputSchema = z.object({
  comment: z.string().trim().max(1000).optional(),
  version: z.number().int().positive(),
}).strict().openapi('DecideReimbursementClaimInput');
```

Permission and error constants come from `packages/contracts/src/permissions.ts` and `errors.ts`; never write the strings inline in modules.

## 3. Domain (`packages/domain`)

```ts
// packages/domain/src/reimbursements/transitions.ts
import type { ReimbursementClaimStatus } from '@hrm/contracts';

const allowed: Record<string, readonly ReimbursementClaimStatus[]> = {
  submit:   ['draft'],
  withdraw: ['submitted'],
  approve:  ['submitted'],
  reject:   ['submitted'],
};

/** DOMAIN-MODEL 5.5. Returns the next status, or null when the action is not allowed. */
export function nextClaimStatus(current: ReimbursementClaimStatus, action: keyof typeof allowed): ReimbursementClaimStatus | null {
  if (!allowed[action]?.includes(current)) return null;
  return ({ submit: 'submitted', withdraw: 'withdrawn', approve: 'approved', reject: 'rejected' } as const)[action];
}
```

Test it with a table of every `(status, action)` pair.

## 4. Repository

```ts
// apps/api/src/modules/reimbursements/reimbursements.repository.ts
import { and, eq } from 'drizzle-orm';
import { reimbursementClaims } from '@hrm/db/schema';
import { whereEmployeeInScope, type RequestScope, type Tx } from '@hrm/db';

export async function findClaimForUpdate(tx: Tx, scope: RequestScope, id: string) {
  const [row] = await tx.select().from(reimbursementClaims)
    .where(and(
      eq(reimbursementClaims.id, id),
      eq(reimbursementClaims.companyId, scope.companyId),
      whereEmployeeInScope(reimbursementClaims.employeeId, scope),
    ))
    .for('update');
  return row ?? null;
}

export async function updateClaimDecision(tx: Tx, id: string, expectedVersion: number,
  values: { status: 'approved' | 'rejected'; decidedBy: string; decidedAt: Date; decisionComment: string | null }) {
  const rows = await tx.update(reimbursementClaims)
    .set({ ...values, version: sql`${reimbursementClaims.version} + 1`, updatedAt: values.decidedAt, updatedBy: values.decidedBy })
    .where(and(eq(reimbursementClaims.id, id), eq(reimbursementClaims.version, expectedVersion)))
    .returning();
  return rows[0] ?? null;
}
```

Repositories accept `tx`, never open transactions, and never check permissions.

## 5. Policy

```ts
// apps/api/src/modules/reimbursements/reimbursements.policy.ts
import { P } from '@hrm/contracts/permissions';
import type { AuthContext } from '../../middleware/session';

/** Scope for reviewing claims: .all wins over .team; neither means no access. */
export function reviewScope(auth: AuthContext) {
  if (auth.can(P.reimbursement.review.all)) return auth.scopeAll();
  if (auth.can(P.reimbursement.review.team)) return auth.scopeTeam();
  return null;
}
```

`auth.scopeTeam()` builds the recursive report list once per request (BUSINESS-RULES 7.2). A `null` scope means the service returns `404 NOT_FOUND` for by-id actions and `403 FORBIDDEN` for list actions.

## 6. Service

```ts
// apps/api/src/modules/reimbursements/reimbursements.service.ts
export async function approveClaim(deps: Deps, auth: AuthContext, id: string, input: DecideClaimInput) {
  const scope = reviewScope(auth);
  if (!scope) throw notFound();

  return deps.db.transaction(async (tx) => {
    const claim = await repo.findClaimForUpdate(tx, scope, id);
    if (!claim) throw notFound();
    if (claim.employeeId === auth.employeeId) throw new AppError('SELF_APPROVAL_FORBIDDEN', 403);

    const next = nextClaimStatus(claim.status, 'approve');
    if (!next) throw invalidTransition(claim.status, 'approve');

    const now = deps.clock.now();
    const updated = await repo.updateClaimDecision(tx, id, input.version,
      { status: 'approved', decidedBy: auth.userId, decidedAt: now, decisionComment: input.comment ?? null });
    if (!updated) throw new AppError('VERSION_CONFLICT', 409);

    await approvals.completeStep(tx, { subject: { reimbursementClaimId: id }, decision: 'approved', auth, comment: input.comment });
    await audit.record(tx, { action: 'reimbursement_claim.approved', category: 'business', entityType: 'reimbursement_claim',
      entityId: id, employeeId: claim.employeeId, metadata: { from: claim.status, to: 'approved' } });
    const outboxIds = await outbox.enqueue(tx, { topic: 'email.request_decided',
      payload: { subjectType: 'reimbursement_claim', subjectId: id, decision: 'approved' },
      dedupeKey: `reimbursement_claim.approved:${id}` });

    return { claim: toClaimDto(updated), outboxIds };
  });
}
```

The order inside the transaction is fixed: load with lock, check, write, approval step, audit, outbox.

## 7. Route

```ts
// apps/api/src/modules/reimbursements/reimbursements.routes.ts
const approveRoute = createRoute({
  method: 'post', path: '/reimbursement-claims/{id}/approve',
  operationId: 'reimbursementClaims.approve', tags: ['reimbursements'],
  'x-permission': 'reimbursement.review.team | reimbursement.review.all',
  request: { params: IdParamSchema, body: { content: { 'application/json': { schema: DecideClaimInputSchema } } } },
  responses: {
    200: { description: 'Approved', content: { 'application/json': { schema: ReimbursementClaimDtoSchema } } },
    ...problemResponses(403, 404, 409),
  },
});

router.openapi(approveRoute, async (c) => {
  const { claim, outboxIds } = await approveClaim(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json'));
  c.executionCtx.waitUntil(processOutbox(c.env, outboxIds));
  return c.json(claim, 200);
});
```

Routes contain no business logic: validate, call the service, start after-commit work, return.

## 8. Tests

```ts
describe('POST /reimbursement-claims/{id}/approve', () => {
  it('lets the direct manager approve a submitted claim', ...);
  it('lets hr_admin approve a claim of an employee without a manager', ...);
  it('returns 404 to a manager outside the reporting line (IDOR)', ...);
  it('returns 404 to an employee approving their own claim through another id', ...);
  it('returns 403 SELF_APPROVAL_FORBIDDEN when a manager approves their own claim', ...);
  it('returns 409 INVALID_TRANSITION for an approved claim', ...);
  it('returns 409 VERSION_CONFLICT for a stale version', ...);
  it('writes an audit row and one outbox row in the same transaction', ...);
});
```

API tests run in the Workers runtime against a real Postgres (`docs/07-quality/TESTING-STRATEGY.md`) with seeded users for each role.

## 9. A new module

1. Create `apps/api/src/modules/<module>/` with the five files (`routes`, `service`, `repository`, `policy`, `test`).
2. Add tables to `packages/db/src/schema/<module>.ts` and generate a migration (DATABASE-CONVENTIONS section 3). Add the tables to `DATA-MODEL.md` in the same PR.
3. Add permissions to `packages/contracts/src/permissions.ts`, the seed, and `SECURITY-MODEL.md` (requires a decision-log entry, since the matrix is canonical).
4. Mount the router in `apps/api/src/app.ts` under `/api/v1`.
5. Add the module to the dependency-cruiser rules if it introduces a new package.
