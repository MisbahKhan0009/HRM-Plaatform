import { AUDIT_REDACTED_KEYS, type AuditAction, type AuditCategory } from '@hrm/contracts';
import { type Queryable, schema, uuidv7 } from '@hrm/db';
import type { Actor } from './auth-context';

export interface AuditEvent {
  action: AuditAction;
  category: AuditCategory;
  entityType: string;
  entityId?: string | null;
  employeeId?: string | null;
  metadata?: Record<string, unknown>;
}

const redacted = new Set(AUDIT_REDACTED_KEYS.map((k) => k.toLowerCase()));

/** Deny-list redaction (AUDIT.md §4): secrets and personal data keep their key, never their value. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value))
    out[k] = redacted.has(k.toLowerCase()) ? 'changed' : redact(v, depth + 1);
  return out;
}

/** Writes one audit row in the caller's transaction (AUDIT.md §1): the change and its audit commit together. */
export async function recordAudit(tx: Queryable, actor: Actor, event: AuditEvent) {
  await tx.insert(schema.auditLogs).values({
    id: uuidv7(),
    companyId: actor.companyId,
    actorUserId: actor.userId,
    actorType: actor.type,
    action: event.action,
    category: event.category,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    employeeId: event.employeeId ?? null,
    requestId: actor.requestId,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    metadata: redact(event.metadata ?? {}) as Record<string, unknown>,
  });
}
