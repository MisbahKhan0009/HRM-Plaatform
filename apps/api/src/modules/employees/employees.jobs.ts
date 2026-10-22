import type { EmployeeStatus } from '@hrm/contracts';
import { eventUpdates, isAllowedStatusChange } from '@hrm/domain';
import type { DailyStep } from '../../jobs/dispatcher';
import { recordAudit } from '../../lib/audit';
import { systemActor } from '../../lib/auth-context';
import { reassignPendingSteps } from '../approvals/approvals.service';
import * as repo from './employees.repository';

/**
 * `employee.apply_effective_events` (JOBS-AND-OUTBOX §3): applies scheduled employment events whose date has come.
 * Each event is re-checked against the employee as it is now: a status change must still start from the recorded
 * status and be a DOMAIN-MODEL §5.2 transition, and a manager change must not create a cycle (BUSINESS-RULES §7.1).
 * Events that no longer fit are cancelled, never half-applied. An event changes status once, so a re-run is a no-op.
 */
export const applyEffectiveEvents: DailyStep = {
  job: 'employee.apply_effective_events',
  runsOn: () => true,
  runKey: (ctx) => ctx.today,
  async run(tx, ctx) {
    const due = await repo.dueEvents(tx, ctx.companyId, ctx.today);
    if (!due.length) return { items: 0 };
    const now = ctx.deps.clock.now();
    const actor = systemActor(ctx.companyId);
    let applied = 0;
    let cancelled = 0;
    for (const event of due) {
      const emp = await repo.lockEmployee(tx, ctx.companyId, event.employeeId);
      if (!emp) continue;
      const updates = eventUpdates(event.changes);
      const statusChange = (event.changes as { status?: { from: EmployeeStatus; to: EmployeeStatus } })
        .status;
      let reason: string | null = null;
      if (statusChange) {
        if (emp.status !== statusChange.from || !isAllowedStatusChange(statusChange.from, statusChange.to))
          reason = 'status_changed_since';
      } else if (emp.status === 'archived') reason = 'employee_archived';
      const managerId = updates.managerId as string | null | undefined;
      if (
        !reason &&
        managerId &&
        (managerId === emp.id || (await repo.wouldCreateCycle(tx, emp.id, managerId)))
      )
        reason = 'reporting_cycle';

      if (reason) {
        await repo.settleEvent(tx, event.id, 'cancelled', now);
        await recordAudit(tx, actor, {
          action: 'employment_event.cancelled',
          category: 'business',
          entityType: 'employment_event',
          entityId: event.id,
          employeeId: emp.id,
          metadata: { type: event.type, effectiveDate: event.effectiveDate, reason },
        });
        cancelled += 1;
        continue;
      }
      await repo.updateEmployee(tx, ctx.companyId, emp.id, null, {
        ...(updates as Partial<repo.EmployeeRow>),
        updatedBy: null,
        updatedAt: now,
      });
      await repo.settleEvent(tx, event.id, 'applied', now);
      if (managerId !== undefined && managerId !== emp.managerId)
        await reassignPendingSteps(tx, ctx.companyId, emp.id, now);
      await recordAudit(tx, actor, {
        action: 'employment_event.applied',
        category: 'business',
        entityType: 'employment_event',
        entityId: event.id,
        employeeId: emp.id,
        metadata: { type: event.type, effectiveDate: event.effectiveDate },
      });
      if (statusChange) {
        await recordAudit(tx, actor, {
          action: 'employee.status_changed',
          category: 'business',
          entityType: 'employee',
          entityId: emp.id,
          employeeId: emp.id,
          metadata: { from: statusChange.from, to: statusChange.to, effectiveDate: event.effectiveDate },
        });
      }
      applied += 1;
    }
    return { items: applied + cancelled, details: { applied, cancelled } };
  },
};

/**
 * `accounts.apply_access_revocation` (JOBS-AND-OUTBOX §3): deactivates the login of employees whose last employed
 * day has passed and revokes their sessions. The employee record and its history are unchanged (FR-EMP-012).
 * Deactivated users are skipped, so a re-run changes nothing.
 */
export const applyAccessRevocation: DailyStep = {
  job: 'accounts.apply_access_revocation',
  runsOn: () => true,
  runKey: (ctx) => ctx.today,
  async run(tx, ctx) {
    const due = await repo.usersToRevoke(tx, ctx.companyId, ctx.yesterday);
    if (!due.length) return { items: 0 };
    const now = ctx.deps.clock.now();
    await repo.deactivateUsers(
      tx,
      due.map((d) => d.userId),
      now,
    );
    const actor = systemActor(ctx.companyId);
    for (const d of due) {
      await recordAudit(tx, actor, {
        action: 'user.deactivated',
        category: 'security',
        entityType: 'user',
        entityId: d.userId,
        employeeId: d.employeeId,
        metadata: { reason: 'employee_separated' },
      });
    }
    return { items: due.length };
  },
};
