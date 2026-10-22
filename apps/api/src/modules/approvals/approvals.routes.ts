import { createRoute } from '@hono/zod-openapi';
import {
  ApprovalDetailSchema,
  ApprovalListQuerySchema,
  ApprovalSummarySchema,
  IdParamSchema,
  P,
  paginated,
} from '@hrm/contracts';
import { requirePermission } from '../../lib/guards';
import { jsonContent, problemResponses, SESSION_SECURITY } from '../../lib/openapi';
import { pageMeta, pageOffset } from '../../lib/pagination';
import { createRouter } from '../../lib/router';
import { getApprovalDetail } from './approvals.read';
import * as repo from './approvals.repository';

export const approvalRoutes = createRouter();

approvalRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/approvals/inbox',
    operationId: 'approvals.inbox',
    tags: ['approvals'],
    'x-permission': 'approval.inbox',
    security: SESSION_SECURITY,
    request: { query: ApprovalListQuerySchema },
    responses: {
      200: jsonContent(paginated(ApprovalSummarySchema), 'Pending approvals for you'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => {
    const { auth, deps } = c.var;
    requirePermission(auth, P.approval.inbox);
    const q = c.req.valid('query');
    const result = await repo.inbox(deps.db, {
      companyId: auth.companyId,
      userId: auth.userId,
      permissions: auth.permissions,
      limit: q.pageSize,
      offset: pageOffset(q),
      ...(q.subjectType ? { subjectType: q.subjectType } : {}),
    });
    return c.json({ data: result.items, page: pageMeta(q, result.total) }, 200);
  },
);

approvalRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/approvals/mine',
    operationId: 'approvals.mine',
    tags: ['approvals'],
    security: SESSION_SECURITY,
    request: { query: ApprovalListQuerySchema },
    responses: {
      200: jsonContent(paginated(ApprovalSummarySchema), 'Requests you raised'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => {
    const { auth, deps } = c.var;
    const q = c.req.valid('query');
    const result = await repo.mine(deps.db, {
      companyId: auth.companyId,
      userId: auth.userId,
      limit: q.pageSize,
      offset: pageOffset(q),
      ...(q.subjectType ? { subjectType: q.subjectType } : {}),
    });
    return c.json({ data: result.items, page: pageMeta(q, result.total) }, 200);
  },
);

approvalRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/approvals/{id}',
    operationId: 'approvals.get',
    tags: ['approvals'],
    'x-permission': 'approver, requester or audit.read.all',
    security: SESSION_SECURITY,
    request: { params: IdParamSchema },
    responses: {
      200: jsonContent(ApprovalDetailSchema, 'Approval request with its steps'),
      ...problemResponses(401, 403, 404),
    },
  }),
  async (c) => c.json(await getApprovalDetail(c.var.deps, c.var.auth, c.req.valid('param').id), 200),
);
