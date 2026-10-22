import { type AuditCategory, type AuditLogEntry, type AuditLogQuery, P } from '@hrm/contracts';
import { schema } from '@hrm/db';
import { businessDayBounds } from '@hrm/domain';
import { and, desc, eq, gte, inArray, lt, type SQL, sql } from 'drizzle-orm';
import type { AuthContext } from '../../lib/auth-context';
import type { Deps } from '../../lib/deps';
import { forbidden } from '../../lib/problem';

const { auditLogs, users } = schema;

/**
 * Category visibility (AUDIT.md §5). `visible`: rows the caller may list. `detailed`: rows whose metadata the caller
 * may read. A reader with only `audit.read.technical` sees security events as actor and action, without metadata.
 */
export function auditVisibility(auth: AuthContext) {
  const visible = new Set<AuditCategory>();
  const detailed = new Set<AuditCategory>();
  if (auth.can(P.audit.read.all))
    for (const c of ['business', 'payroll', 'security'] as const) {
      visible.add(c);
      detailed.add(c);
    }
  if (auth.can(P.audit.read.payroll)) {
    visible.add('payroll');
    detailed.add('payroll');
  }
  if (auth.can(P.audit.read.technical)) {
    visible.add('technical');
    visible.add('security');
    detailed.add('technical');
  }
  return { visible, detailed };
}

export async function listAuditLogs(deps: Deps, auth: AuthContext, q: AuditLogQuery) {
  const { visible, detailed } = auditVisibility(auth);
  if (!visible.size) throw forbidden();
  const categories = [...visible].filter((c) => !q.category || c === q.category);
  if (!categories.length) return { items: [] as AuditLogEntry[], total: 0 };

  const conditions: (SQL | undefined)[] = [
    eq(auditLogs.companyId, auth.companyId),
    gte(auditLogs.occurredAt, businessDayBounds(q.from).start),
    lt(auditLogs.occurredAt, businessDayBounds(q.to).end),
    inArray(auditLogs.category, categories),
    q.actorUserId ? eq(auditLogs.actorUserId, q.actorUserId) : undefined,
    q.action ? sql`starts_with(${auditLogs.action}, ${q.action})` : undefined,
    q.entityType ? eq(auditLogs.entityType, q.entityType) : undefined,
    q.entityId ? eq(auditLogs.entityId, q.entityId) : undefined,
    q.employeeId ? eq(auditLogs.employeeId, q.employeeId) : undefined,
  ];
  const where = and(...conditions);
  const rows = await deps.db
    .select({ log: auditLogs, actorName: users.name, total: sql<string>`count(*) OVER ()` })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(where)
    .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);

  const items = rows.map(({ log, actorName }): AuditLogEntry => {
    const category = log.category as AuditCategory;
    return {
      id: log.id,
      occurredAt: log.occurredAt.toISOString(),
      actorUserId: log.actorUserId,
      actorName: actorName ?? null,
      actorType: log.actorType as AuditLogEntry['actorType'],
      action: log.action,
      category,
      entityType: log.entityType,
      entityId: log.entityId,
      employeeId: log.employeeId,
      requestId: log.requestId,
      ipAddress: log.ipAddress,
      ...(detailed.has(category) ? { metadata: log.metadata as Record<string, unknown> } : {}),
    };
  });
  return { items, total: Number(rows[0]?.total ?? 0) };
}
