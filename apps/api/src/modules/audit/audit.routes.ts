import { createRoute } from '@hono/zod-openapi';
import { AuditLogEntrySchema, AuditLogQuerySchema, paginated } from '@hrm/contracts';
import { jsonContent, problemResponses, SESSION_SECURITY } from '../../lib/openapi';
import { pageMeta } from '../../lib/pagination';
import { createRouter } from '../../lib/router';
import * as service from './audit.service';

export const auditRoutes = createRouter();

auditRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/audit-logs',
    operationId: 'auditLogs.list',
    tags: ['audit'],
    security: SESSION_SECURITY,
    description:
      'Newest first. `from`/`to` are Asia/Dhaka dates (inclusive, at most 366 days). Rows are limited to the ' +
      'categories the caller may read; `metadata` is omitted where only actor and action are visible (AUDIT.md §5).',
    'x-permission': 'audit.read.all | audit.read.payroll | audit.read.technical',
    request: { query: AuditLogQuerySchema },
    responses: {
      200: jsonContent(paginated(AuditLogEntrySchema), 'Audit log entries'),
      ...problemResponses(400, 401, 403),
    },
  }),
  async (c) => {
    const q = c.req.valid('query');
    const result = await service.listAuditLogs(c.var.deps, c.var.auth, q);
    return c.json({ data: result.items, page: pageMeta(q, result.total) }, 200);
  },
);
