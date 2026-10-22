import { createRoute } from '@hono/zod-openapi';
import {
  HealthDetailsSchema,
  JobListSchema,
  JobParamSchema,
  JobRunResultSchema,
  OutboxRetryResultSchema,
  RunJobInputSchema,
} from '@hrm/contracts';
import { jsonBody, jsonContent, problemResponses, SESSION_SECURITY } from '../../lib/openapi';
import { processOutbox } from '../../lib/outbox';
import { createRouter } from '../../lib/router';
import * as service from './system.service';

export const systemRoutes = createRouter();
const tags = ['health'];
const security = SESSION_SECURITY;

systemRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/health/details',
    operationId: 'health.details',
    tags,
    security,
    'x-permission': 'system.health.read',
    responses: {
      200: jsonContent(HealthDetailsSchema, 'Database, jobs, outbox and email status'),
      ...problemResponses(401, 403),
    },
  }),
  async (c) => c.json(await service.healthDetails(c.var.deps, c.var.auth), 200),
);

systemRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/admin/jobs/{job}/run',
    operationId: 'admin.runJob',
    tags,
    security,
    description:
      "Runs one daily step for `date` (default today, Asia/Dhaka) and `runKey` (default the step's key for that " +
      'date). A key that already succeeded returns `outcome: "skipped"`.',
    'x-permission': 'system.health.read + settings.technical.manage, strong session',
    request: { params: JobParamSchema, body: jsonBody(RunJobInputSchema) },
    responses: {
      200: jsonContent(JobRunResultSchema, 'Run outcome'),
      ...problemResponses(400, 401, 403, 404),
    },
  }),
  async (c) =>
    c.json(
      await service.runDailyStep(c.var.deps, c.var.auth, c.req.valid('param').job, c.req.valid('json')),
      200,
    ),
);

systemRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/admin/jobs',
    operationId: 'admin.listJobs',
    tags,
    security,
    'x-permission': 'system.health.read',
    responses: {
      200: jsonContent(JobListSchema, 'Daily steps with their last run'),
      ...problemResponses(401, 403),
    },
  }),
  async (c) => c.json(await service.listJobs(c.var.deps, c.var.auth), 200),
);

systemRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/admin/outbox/retry',
    operationId: 'admin.retryOutbox',
    tags,
    security,
    description:
      'Makes every `failed` outbox message due now and sends up to 20 of them after the response. `dead` ' +
      'messages are not retried.',
    'x-permission': 'system.health.read + settings.technical.manage, strong session',
    responses: {
      200: jsonContent(OutboxRetryResultSchema, 'Messages reset and being sent'),
      ...problemResponses(401, 403),
    },
  }),
  async (c) => {
    const { deps, auth } = c.var;
    const { result, outboxIds } = await service.retryFailedOutbox(deps, auth);
    deps.defer(processOutbox(deps, outboxIds));
    return c.json(result, 200);
  },
);
