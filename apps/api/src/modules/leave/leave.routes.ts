import { createRoute, z } from '@hono/zod-openapi';
import {
  AdjustLeaveBalanceInputSchema,
  BalancesQuerySchema,
  CancelLeaveRequestInputSchema,
  CreateLeavePolicyInputSchema,
  CreateLeaveRequestInputSchema,
  CreateLeaveTypeInputSchema,
  DecisionInputSchema,
  IdParamSchema,
  LeaveBalanceSchema,
  LeaveCalendarQuerySchema,
  LeaveCalendarSchema,
  LeaveEmployeeParamSchema,
  LeaveLedgerEntrySchema,
  LeavePolicySchema,
  LeaveRequestPreviewSchema,
  LeaveRequestSchema,
  LeaveRequestsQuerySchema,
  LeaveTypeQuerySchema,
  LeaveTypeSchema,
  LeaveVersionInputSchema,
  LedgerQuerySchema,
  MyBalancesQuerySchema,
  MyLeaveBalancesSchema,
  PreviewLeaveRequestInputSchema,
  paginated,
  RejectInputSchema,
  UpdateLeaveTypeInputSchema,
} from '@hrm/contracts';
import { idempotent } from '../../lib/idempotency';
import { jsonBody, jsonContent, problemResponses, SESSION_SECURITY } from '../../lib/openapi';
import { processOutbox } from '../../lib/outbox';
import { createRouter } from '../../lib/router';
import * as service from './leave.service';
import * as requests from './leave-requests.service';

export const leaveRoutes = createRouter();
const tags = ['leave'];
const security = SESSION_SECURITY;
const list = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item) });
const idempotencyHeader = z.object({ 'idempotency-key': z.string().min(8).max(100) });
const REVIEW = 'leave.request.review.team | leave.request.review.all';

// Types and policies ------------------------------------------------------------------------------------------------

leaveRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/leave/types',
    operationId: 'leaveTypes.list',
    tags,
    security,
    request: { query: LeaveTypeQuerySchema },
    responses: { 200: jsonContent(list(LeaveTypeSchema), 'Leave types'), ...problemResponses(400, 401) },
  }),
  async (c) =>
    c.json(
      {
        data: await service.listTypes(c.var.deps, c.var.auth, c.req.valid('query').includeInactive ?? false),
      },
      200,
    ),
);

leaveRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/leave/types',
    operationId: 'leaveTypes.create',
    tags,
    security,
    'x-permission': 'leave.policy.manage',
    request: { body: jsonBody(CreateLeaveTypeInputSchema) },
    responses: { 201: jsonContent(LeaveTypeSchema, 'Created'), ...problemResponses(400, 401, 403, 409) },
  }),
  async (c) => {
    const dto = await service.createType(c.var.deps, c.var.auth, c.req.valid('json'));
    c.header('Location', `/api/v1/leave/types/${dto.id}`);
    return c.json(dto, 201);
  },
);

leaveRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/leave/types/{id}',
    operationId: 'leaveTypes.update',
    tags,
    security,
    'x-permission': 'leave.policy.manage',
    request: { params: IdParamSchema, body: jsonBody(UpdateLeaveTypeInputSchema) },
    responses: { 200: jsonContent(LeaveTypeSchema, 'Updated'), ...problemResponses(400, 401, 403, 404, 409) },
  }),
  async (c) =>
    c.json(
      await service.updateType(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      200,
    ),
);

leaveRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/leave/types/{id}/policies',
    operationId: 'leavePolicies.list',
    tags,
    security,
    'x-permission': 'leave.policy.manage',
    request: { params: IdParamSchema },
    responses: {
      200: jsonContent(list(LeavePolicySchema), 'Policy versions, newest first'),
      ...problemResponses(401, 403, 404),
    },
  }),
  async (c) =>
    c.json({ data: await service.listPolicies(c.var.deps, c.var.auth, c.req.valid('param').id) }, 200),
);

leaveRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/leave/types/{id}/policies',
    operationId: 'leavePolicies.create',
    tags,
    security,
    'x-permission': 'leave.policy.manage',
    request: { params: IdParamSchema, body: jsonBody(CreateLeavePolicyInputSchema) },
    responses: {
      201: jsonContent(LeavePolicySchema, 'New policy version'),
      ...problemResponses(400, 401, 403, 404, 422),
    },
  }),
  async (c) => {
    const id = c.req.valid('param').id;
    const dto = await service.createPolicy(c.var.deps, c.var.auth, id, c.req.valid('json'));
    c.header('Location', `/api/v1/leave/types/${id}/policies`);
    return c.json(dto, 201);
  },
);

// Balances ----------------------------------------------------------------------------------------------------------

leaveRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/leave/balances/me',
    operationId: 'leaveBalances.me',
    tags,
    security,
    'x-permission': 'leave.request.own',
    request: { query: MyBalancesQuerySchema },
    responses: {
      200: jsonContent(MyLeaveBalancesSchema, 'Own balances'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await service.myBalances(c.var.deps, c.var.auth, c.req.valid('query').year), 200),
);

leaveRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/leave/balances',
    operationId: 'leaveBalances.list',
    tags,
    security,
    'x-permission': 'leave.read.all | leave.read.team',
    request: { query: BalancesQuerySchema },
    responses: {
      200: jsonContent(paginated(LeaveBalanceSchema), 'Balances'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await service.listBalances(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

leaveRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/leave/balances/{employeeId}/ledger',
    operationId: 'leaveBalances.ledger',
    tags,
    security,
    'x-permission': 'leave.read.all | leave.read.team | own',
    request: { params: LeaveEmployeeParamSchema, query: LedgerQuerySchema },
    responses: {
      200: jsonContent(paginated(LeaveLedgerEntrySchema), 'Ledger entries'),
      ...problemResponses(400, 401, 404),
    },
  }),
  async (c) =>
    c.json(
      await service.ledger(c.var.deps, c.var.auth, c.req.valid('param').employeeId, c.req.valid('query')),
      200,
    ),
);

leaveRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/leave/balances/adjustments',
    operationId: 'leaveBalances.adjust',
    tags,
    security,
    'x-permission': 'leave.balance.adjust',
    middleware: [idempotent('leave.balance.adjust')] as const,
    request: { headers: idempotencyHeader, body: jsonBody(AdjustLeaveBalanceInputSchema) },
    responses: {
      201: jsonContent(LeaveBalanceSchema, 'Balance after the adjustment'),
      ...problemResponses(400, 401, 403, 409, 422),
    },
  }),
  async (c) => c.json(await service.adjustBalance(c.var.deps, c.var.auth, c.req.valid('json')), 201),
);

// Requests ----------------------------------------------------------------------------------------------------------

leaveRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/leave/requests/preview',
    operationId: 'leaveRequests.preview',
    tags,
    security,
    'x-permission': 'leave.request.own | leave.request.review.all',
    request: { body: jsonBody(PreviewLeaveRequestInputSchema) },
    responses: {
      200: jsonContent(LeaveRequestPreviewSchema, 'Working days and balance effect'),
      ...problemResponses(400, 401, 403, 422),
    },
  }),
  async (c) => c.json(await requests.previewRequest(c.var.deps, c.var.auth, c.req.valid('json')), 200),
);

leaveRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/leave/requests',
    operationId: 'leaveRequests.list',
    tags,
    security,
    'x-permission': 'leave.read.all | leave.read.team | own',
    request: { query: LeaveRequestsQuerySchema },
    responses: {
      200: jsonContent(paginated(LeaveRequestSchema), 'Leave requests'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await requests.listRequests(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

leaveRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/leave/requests',
    operationId: 'leaveRequests.create',
    tags,
    security,
    'x-permission': 'leave.request.own | leave.request.review.all (on behalf)',
    request: { body: jsonBody(CreateLeaveRequestInputSchema) },
    responses: {
      201: jsonContent(LeaveRequestSchema, 'Created in pending'),
      ...problemResponses(400, 401, 403, 409, 422),
    },
  }),
  async (c) => {
    const { request, outboxIds } = await requests.createRequest(c.var.deps, c.var.auth, c.req.valid('json'));
    c.var.deps.defer(processOutbox(c.var.deps, outboxIds));
    c.header('Location', `/api/v1/leave/requests/${request.id}`);
    return c.json(request, 201);
  },
);

leaveRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/leave/requests/{id}',
    operationId: 'leaveRequests.get',
    tags,
    security,
    'x-permission': 'leave.read.all | leave.read.team | review scopes | own',
    request: { params: IdParamSchema },
    responses: { 200: jsonContent(LeaveRequestSchema, 'Leave request'), ...problemResponses(401, 404) },
  }),
  async (c) => c.json(await requests.getRequest(c.var.deps, c.var.auth, c.req.valid('param').id), 200),
);

leaveRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/leave/requests/{id}/withdraw',
    operationId: 'leaveRequests.withdraw',
    tags,
    security,
    'x-permission': 'leave.request.own (own request)',
    request: { params: IdParamSchema, body: jsonBody(LeaveVersionInputSchema) },
    responses: { 200: jsonContent(LeaveRequestSchema, 'Withdrawn'), ...problemResponses(400, 401, 404, 409) },
  }),
  async (c) =>
    c.json(
      await requests.withdrawRequest(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      200,
    ),
);

leaveRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/leave/requests/{id}/approve',
    operationId: 'leaveRequests.approve',
    tags,
    security,
    'x-permission': REVIEW,
    middleware: [idempotent('leave.request.approve')] as const,
    request: { params: IdParamSchema, headers: idempotencyHeader, body: jsonBody(DecisionInputSchema) },
    responses: {
      200: jsonContent(LeaveRequestSchema, 'Approved'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) => {
    const { request, outboxIds } = await requests.approveRequest(
      c.var.deps,
      c.var.auth,
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    c.var.deps.defer(processOutbox(c.var.deps, outboxIds));
    return c.json(request, 200);
  },
);

leaveRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/leave/requests/{id}/reject',
    operationId: 'leaveRequests.reject',
    tags,
    security,
    'x-permission': REVIEW,
    request: { params: IdParamSchema, body: jsonBody(RejectInputSchema) },
    responses: {
      200: jsonContent(LeaveRequestSchema, 'Rejected'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) => {
    const { request, outboxIds } = await requests.rejectRequest(
      c.var.deps,
      c.var.auth,
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    c.var.deps.defer(processOutbox(c.var.deps, outboxIds));
    return c.json(request, 200);
  },
);

leaveRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/leave/requests/{id}/cancel',
    operationId: 'leaveRequests.cancel',
    tags,
    security,
    'x-permission': 'leave.request.own (own request) | leave.request.review.all (on behalf)',
    request: { params: IdParamSchema, body: jsonBody(CancelLeaveRequestInputSchema) },
    responses: {
      200: jsonContent(LeaveRequestSchema, 'Cancellation pending'),
      ...problemResponses(400, 401, 404, 409, 422),
    },
  }),
  async (c) => {
    const { request, outboxIds } = await requests.requestCancellation(
      c.var.deps,
      c.var.auth,
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    c.var.deps.defer(processOutbox(c.var.deps, outboxIds));
    return c.json(request, 200);
  },
);

leaveRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/leave/requests/{id}/cancel/approve',
    operationId: 'leaveRequests.approveCancellation',
    tags,
    security,
    'x-permission': REVIEW,
    middleware: [idempotent('leave.request.cancel.approve')] as const,
    request: { params: IdParamSchema, headers: idempotencyHeader, body: jsonBody(DecisionInputSchema) },
    responses: {
      200: jsonContent(LeaveRequestSchema, 'Cancelled'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) => {
    const { request, outboxIds } = await requests.approveCancellation(
      c.var.deps,
      c.var.auth,
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    c.var.deps.defer(processOutbox(c.var.deps, outboxIds));
    return c.json(request, 200);
  },
);

leaveRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/leave/requests/{id}/cancel/reject',
    operationId: 'leaveRequests.rejectCancellation',
    tags,
    security,
    'x-permission': REVIEW,
    request: { params: IdParamSchema, body: jsonBody(RejectInputSchema) },
    responses: {
      200: jsonContent(LeaveRequestSchema, 'Back to approved'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) => {
    const { request, outboxIds } = await requests.rejectCancellation(
      c.var.deps,
      c.var.auth,
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    c.var.deps.defer(processOutbox(c.var.deps, outboxIds));
    return c.json(request, 200);
  },
);

// Calendar ----------------------------------------------------------------------------------------------------------

leaveRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/leave/calendar',
    operationId: 'leaveCalendar.get',
    tags,
    security,
    'x-permission': 'leave.read.all | leave.read.team | leave.request.own',
    request: { query: LeaveCalendarQuerySchema },
    responses: {
      200: jsonContent(LeaveCalendarSchema, 'Leave calendar'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await service.calendar(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);
