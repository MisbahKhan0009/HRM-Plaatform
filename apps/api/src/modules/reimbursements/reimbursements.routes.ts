import { createRoute } from '@hono/zod-openapi';
import {
  ClaimActionInputSchema,
  ClaimListQuerySchema,
  CreateClaimInputSchema,
  DecisionInputSchema,
  IdParamSchema,
  paginated,
  ReimbursementClaimSchema,
  RejectInputSchema,
  UpdateClaimInputSchema,
} from '@hrm/contracts';
import { jsonBody, jsonContent, problemResponses, SESSION_SECURITY } from '../../lib/openapi';
import { processOutbox } from '../../lib/outbox';
import { createRouter } from '../../lib/router';
import * as service from './reimbursements.service';

export const reimbursementRoutes = createRouter();
const tags = ['reimbursements'];
const security = SESSION_SECURITY;

reimbursementRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/reimbursement-claims',
    operationId: 'reimbursementClaims.list',
    tags,
    security,
    'x-permission': 'reimbursement.read.all | reimbursement.review.team | reimbursement.request.own',
    request: { query: ClaimListQuerySchema },
    responses: {
      200: jsonContent(paginated(ReimbursementClaimSchema), 'Claims in your scope'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => c.json(await service.listClaims(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

reimbursementRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/reimbursement-claims',
    operationId: 'reimbursementClaims.create',
    tags,
    security,
    'x-permission': 'reimbursement.request.own',
    request: { body: jsonBody(CreateClaimInputSchema) },
    responses: {
      201: jsonContent(ReimbursementClaimSchema, 'Draft claim'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => {
    const dto = await service.createClaim(c.var.deps, c.var.auth, c.req.valid('json'));
    c.header('Location', `/api/v1/reimbursement-claims/${dto.id}`);
    return c.json(dto, 201);
  },
);

reimbursementRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/reimbursement-claims/{id}',
    operationId: 'reimbursementClaims.get',
    tags,
    security,
    'x-permission': 'reimbursement.read.all | reimbursement.review.team | reimbursement.request.own',
    request: { params: IdParamSchema },
    responses: { 200: jsonContent(ReimbursementClaimSchema, 'Claim'), ...problemResponses(401, 404) },
  }),
  async (c) => c.json(await service.getClaim(c.var.deps, c.var.auth, c.req.valid('param').id), 200),
);

reimbursementRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/reimbursement-claims/{id}',
    operationId: 'reimbursementClaims.update',
    tags,
    security,
    'x-permission': 'reimbursement.request.own',
    request: { params: IdParamSchema, body: jsonBody(UpdateClaimInputSchema) },
    responses: {
      200: jsonContent(ReimbursementClaimSchema, 'Updated draft'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) =>
    c.json(
      await service.updateClaim(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      200,
    ),
);

reimbursementRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/reimbursement-claims/{id}',
    operationId: 'reimbursementClaims.delete',
    tags,
    security,
    'x-permission': 'reimbursement.request.own',
    request: { params: IdParamSchema },
    responses: { 204: { description: 'Deleted' }, ...problemResponses(401, 403, 404, 409) },
  }),
  async (c) => {
    await service.deleteClaim(c.var.deps, c.var.auth, c.req.valid('param').id);
    return c.body(null, 204);
  },
);

reimbursementRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/reimbursement-claims/{id}/submit',
    operationId: 'reimbursementClaims.submit',
    tags,
    security,
    'x-permission': 'reimbursement.request.own',
    request: { params: IdParamSchema, body: jsonBody(ClaimActionInputSchema) },
    responses: {
      200: jsonContent(ReimbursementClaimSchema, 'Submitted'),
      ...problemResponses(400, 401, 403, 404, 409, 422),
    },
  }),
  async (c) => {
    const { deps, auth } = c.var;
    const { claim, outboxIds } = await service.submitClaim(
      deps,
      auth,
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    deps.defer(processOutbox(deps, outboxIds));
    return c.json(claim, 200);
  },
);

reimbursementRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/reimbursement-claims/{id}/withdraw',
    operationId: 'reimbursementClaims.withdraw',
    tags,
    security,
    'x-permission': 'reimbursement.request.own',
    request: { params: IdParamSchema, body: jsonBody(ClaimActionInputSchema) },
    responses: {
      200: jsonContent(ReimbursementClaimSchema, 'Withdrawn'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) =>
    c.json(
      await service.withdrawClaim(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      200,
    ),
);

reimbursementRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/reimbursement-claims/{id}/approve',
    operationId: 'reimbursementClaims.approve',
    tags,
    security,
    'x-permission': 'reimbursement.review.team | reimbursement.review.all',
    request: { params: IdParamSchema, body: jsonBody(DecisionInputSchema) },
    responses: {
      200: jsonContent(ReimbursementClaimSchema, 'Approved'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) => {
    const { deps, auth } = c.var;
    const { claim, outboxIds } = await service.approveClaim(
      deps,
      auth,
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    deps.defer(processOutbox(deps, outboxIds));
    return c.json(claim, 200);
  },
);

reimbursementRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/reimbursement-claims/{id}/reject',
    operationId: 'reimbursementClaims.reject',
    tags,
    security,
    'x-permission': 'reimbursement.review.team | reimbursement.review.all',
    request: { params: IdParamSchema, body: jsonBody(RejectInputSchema) },
    responses: {
      200: jsonContent(ReimbursementClaimSchema, 'Rejected'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) => {
    const { deps, auth } = c.var;
    const { claim, outboxIds } = await service.rejectClaim(
      deps,
      auth,
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    deps.defer(processOutbox(deps, outboxIds));
    return c.json(claim, 200);
  },
);
