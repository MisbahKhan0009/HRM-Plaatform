import { AUDIT_ACTIONS, type AuditCategory, type AuditLogEntry } from '@hrm/contracts';
import { queryOptions } from '@tanstack/react-query';
import { api } from '../../lib/api/client';

export interface AuditSearch {
  page: number;
  pageSize: number;
  from: string;
  to: string;
  action?: string | undefined;
  category?: AuditCategory | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  actorUserId?: string | undefined;
  employeeId?: string | undefined;
}

type Page<T> = { data: T[]; page: { number: number; size: number; totalItems: number; totalPages: number } };

export const auditQueries = {
  all: () => ['audit'] as const,
  list: (p: AuditSearch) =>
    queryOptions({
      queryKey: [...auditQueries.all(), 'list', p],
      queryFn: () => api.get<Page<AuditLogEntry>>('/audit-logs', { query: { ...p } }),
    }),
};

/** `YYYY-MM-DD` plus n days (business dates have no zone). */
export function addDaysIso(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Days from `from` to `to` inclusive. */
export const spanDays = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** Problem with a date range the API would refuse (AuditLogQuerySchema): null when it's fine. */
export function rangeProblem(from: string, to: string): string | null {
  if (from > to) return 'The end date is before the start date.';
  if (spanDays(from, to) > 366) return 'Choose at most 366 days.';
  return null;
}

/** Action filter options: each entity prefix (`payroll_run.`) followed by its actions (AUDIT.md §3). */
export const ACTION_GROUPS = AUDIT_ACTIONS.reduce<{ prefix: string; actions: string[] }[]>((acc, a) => {
  const prefix = `${a.split('.')[0]}.`;
  const group = acc.find((g) => g.prefix === prefix);
  if (group) group.actions.push(a);
  else acc.push({ prefix, actions: [a] });
  return acc;
}, []);

export const CATEGORY_LABEL: Record<AuditCategory, string> = {
  business: 'Business',
  payroll: 'Payroll',
  security: 'Security',
  technical: 'Technical',
};

/** Metadata values as text: scalars as is, objects as compact JSON. */
export function metadataText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}
