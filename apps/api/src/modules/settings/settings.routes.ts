import { createRoute } from '@hono/zod-openapi';
import { SettingsGroupsSchema, UpdateSettingsInputSchema } from '@hrm/contracts';
import { jsonBody, jsonContent, problemResponses, SESSION_SECURITY } from '../../lib/openapi';
import { createRouter } from '../../lib/router';
import * as service from './settings.service';

export const settingsRoutes = createRouter();
const tags = ['settings'];
const security = SESSION_SECURITY;

settingsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/settings',
    operationId: 'settings.get',
    tags,
    security,
    'x-permission': 'settings.read | settings.<scope>.manage (that scope only)',
    responses: {
      200: jsonContent(SettingsGroupsSchema, 'Settings the caller may read, grouped by scope'),
      ...problemResponses(401, 403),
    },
  }),
  async (c) => c.json(await service.getSettings(c.var.deps, c.var.auth), 200),
);

settingsRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/settings',
    operationId: 'settings.update',
    tags,
    security,
    description:
      'Body `{ changes: { "<key>": { value, version } } }`. Each key is validated by its catalogue schema and needs ' +
      '`settings.<scope>.manage`; `version` is the per-key version from `GET /settings` (0 for a key never stored).',
    'x-permission': 'settings.<scope>.manage per key, strong session',
    request: { body: jsonBody(UpdateSettingsInputSchema) },
    responses: {
      200: jsonContent(SettingsGroupsSchema, 'Updated settings'),
      ...problemResponses(400, 401, 403, 409),
    },
  }),
  async (c) => c.json(await service.updateSettings(c.var.deps, c.var.auth, c.req.valid('json')), 200),
);
