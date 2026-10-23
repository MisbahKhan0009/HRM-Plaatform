import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { HealthSchema } from '@hrm/contracts';
import type { AppEnv } from '../../types';

const getHealth = createRoute({
  method: 'get',
  path: '/health',
  operationId: 'health.get',
  tags: ['health'],
  security: [],
  responses: {
    200: { description: 'Service is up', content: { 'application/json': { schema: HealthSchema } } },
  },
});

export const healthRoutes = new OpenAPIHono<AppEnv>().openapi(getHealth, (c) =>
  c.json(
    {
      status: 'ok' as const,
      service: 'hrm-api' as const,
      version: c.env.APP_VERSION,
      time: new Date().toISOString(),
    },
    200,
  ),
);
