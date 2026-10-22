import type { EmployeeStatus, EmploymentEventType } from '@hrm/contracts';

/** Lifecycle actions, one per action endpoint (API-CATALOGUE §4). */
export const employeeActions = [
  'start_preboarding',
  'hire',
  'confirm',
  'start_notice',
  'separate',
  'rehire',
  'archive',
] as const;
export type EmployeeAction = (typeof employeeActions)[number];

/** Allowed source statuses per action (DOMAIN-MODEL §5.2). Anything else is `INVALID_TRANSITION`. */
const FROM: Record<EmployeeAction, readonly EmployeeStatus[]> = {
  start_preboarding: ['draft'],
  hire: ['preboarding'],
  confirm: ['probation'],
  start_notice: ['active'],
  // notice_period → separated, plus immediate separation from active or probation.
  separate: ['notice_period', 'active', 'probation'],
  rehire: ['separated'],
  archive: ['separated'],
};

/** Employment event recorded for each action (DOMAIN-MODEL §4 `employment_event_type`). */
export const ACTION_EVENT_TYPE: Record<EmployeeAction, EmploymentEventType> = {
  start_preboarding: 'status_changed',
  hire: 'hired',
  confirm: 'confirmed',
  start_notice: 'status_changed',
  separate: 'separated',
  rehire: 'rehired',
  archive: 'status_changed',
};

/** Actions that take effect on a chosen date (future = scheduled); the others apply at once. */
export const EFFECTIVE_DATED_ACTIONS: ReadonlySet<EmployeeAction> = new Set([
  'hire',
  'confirm',
  'start_notice',
  'separate',
  'rehire',
]);

/**
 * Next status for a lifecycle action (DOMAIN-MODEL §5.2), or null when the action is not allowed from `current`.
 * `hire` goes to `probation` when the hire sets a probation period, otherwise straight to `active`.
 */
export function nextEmployeeStatus(
  current: EmployeeStatus,
  action: EmployeeAction,
  options: { withProbation?: boolean } = {},
): EmployeeStatus | null {
  if (!FROM[action].includes(current)) return null;
  switch (action) {
    case 'start_preboarding':
      return 'preboarding';
    case 'hire':
      return options.withProbation ? 'probation' : 'active';
    case 'confirm':
      return 'active';
    case 'start_notice':
      return 'notice_period';
    case 'separate':
      return 'separated';
    case 'rehire':
      return 'active';
    case 'archive':
      return 'archived';
  }
}

/** Whether some action moves an employee from `from` to `to` (used when a scheduled event is applied later). */
export function isAllowedStatusChange(from: EmployeeStatus, to: EmployeeStatus): boolean {
  return employeeActions.some(
    (a) => nextEmployeeStatus(from, a) === to || nextEmployeeStatus(from, a, { withProbation: true }) === to,
  );
}

/** An effective-dated change applies now when its date is today or earlier, otherwise it is scheduled. */
export const appliesNow = (effectiveDate: string, today: string) => effectiveDate <= today;

/** Employee columns an employment event may change, in the `changes` JSON of the event (DATA-MODEL §4). */
export const EVENT_FIELDS = [
  'status',
  'joiningDate',
  'probationEndDate',
  'separationDate',
  'separationType',
  'departmentId',
  'positionId',
  'managerId',
] as const;
export type EventField = (typeof EVENT_FIELDS)[number];

export type EventChanges = Partial<Record<EventField, { from: unknown; to: unknown }>>;

/** Keeps only allow-listed fields of a stored `changes` object, and returns the values to write. */
export function eventUpdates(changes: unknown): Partial<Record<EventField, unknown>> {
  const out: Partial<Record<EventField, unknown>> = {};
  if (!changes || typeof changes !== 'object') return out;
  for (const field of EVENT_FIELDS) {
    const change = (changes as Record<string, unknown>)[field];
    if (change && typeof change === 'object' && 'to' in change) out[field] = (change as { to: unknown }).to;
  }
  return out;
}

/**
 * Reporting cycles among new manager links (BUSINESS-RULES §7.1, applied to an import file). `links` maps an
 * employee key to its manager key; returns the keys that sit on a cycle. Existing employees cannot point back to
 * new ones, so cycles can only form among the new links.
 */
export function keysOnCycles(links: ReadonlyMap<string, string>): Set<string> {
  const onCycle = new Set<string>();
  const done = new Set<string>();
  for (const start of links.keys()) {
    if (done.has(start)) continue;
    const path: string[] = [];
    const seen = new Map<string, number>();
    let node: string | undefined = start;
    while (node !== undefined && !done.has(node) && !seen.has(node)) {
      seen.set(node, path.length);
      path.push(node);
      node = links.get(node);
    }
    if (node !== undefined && seen.has(node)) {
      for (const k of path.slice(seen.get(node))) onCycle.add(k);
    }
    for (const k of path) done.add(k);
  }
  return onCycle;
}
