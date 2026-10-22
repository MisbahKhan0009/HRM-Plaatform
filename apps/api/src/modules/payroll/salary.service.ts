import type { CreateSalaryStructureInput, SalaryStructureQuery, VersionInput } from '@hrm/contracts';
import { uuidv7 } from '@hrm/db';
import { addDays } from '@hrm/domain';
import { recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import { withDbErrors } from '../../lib/db-errors';
import type { Deps } from '../../lib/deps';
import { pageMeta, pageOffset } from '../../lib/pagination';
import {
  forbidden,
  invalidTransition,
  notFound,
  ruleViolation,
  validationFailed,
  versionConflict,
} from '../../lib/problem';
import { toStructure } from './payroll.dto';
import { payrollPolicy as policy } from './payroll.policy';
import * as repo from './payroll.repository';

// Salary structures (FR-PAY-001, FR-PAY-003, D-018, US-PAY-001). Salary is served only here, under `compensation.*`,
// never in employee payloads (SECURITY-MODEL §5).

export async function listStructures(deps: Deps, auth: AuthContext, q: SalaryStructureQuery) {
  const scope = policy.compensationScope(auth);
  if (!scope) throw forbidden();
  // Own readers see effective history, not drafts awaiting approval.
  const { rows, total } = await repo.listStructures(
    deps.db,
    scope,
    { ...(q.employeeId ? { employeeId: q.employeeId } : {}), approvedOnly: scope.employees !== 'all' },
    q.pageSize,
    pageOffset(q),
  );
  return { data: rows.map(toStructure), page: pageMeta(q, total) };
}

async function reload(deps: Deps, auth: AuthContext, id: string) {
  const view = await repo.findStructure(deps.db, auth.companyId, id);
  if (!view) throw notFound();
  return toStructure(view);
}

export async function createStructure(deps: Deps, auth: AuthContext, input: CreateSalaryStructureInput) {
  policy.manageCompensation(auth);
  if (!(await repo.employeeInCompany(deps.db, auth.companyId, input.employeeId)))
    throw validationFailed([{ path: '/employeeId', code: 'not_found', message: 'Employee not found.' }]);
  const id = uuidv7();
  await deps.db.transaction(async (tx) => {
    await repo.insertStructure(tx, {
      id,
      companyId: auth.companyId,
      employeeId: input.employeeId,
      currency: input.grossAmount.currency,
      grossAmount: input.grossAmount.amount,
      effectiveFrom: input.effectiveFrom,
      reason: input.reason,
      createdBy: auth.userId,
      updatedBy: auth.userId,
    });
    await recordAudit(tx, auth.actor, {
      action: 'salary_structure.created',
      category: 'payroll',
      entityType: 'salary_structure',
      entityId: id,
      employeeId: input.employeeId,
      metadata: {
        grossAmount: input.grossAmount.amount,
        effectiveFrom: input.effectiveFrom,
        reason: input.reason,
      },
    });
  });
  return reload(deps, auth, id);
}

/**
 * `draft` → `approved` (US-PAY-001). The approved structure that is effective before the new start date ends the day
 * before it; one starting on the same date is `superseded` (PAY-09 correction). A later approved structure is not
 * rewritten: the approval is refused instead of guessing which one wins.
 */
export async function approveStructure(deps: Deps, auth: AuthContext, id: string, input: VersionInput) {
  const now = deps.clock.now();
  policy.approveCompensation(auth, now);
  await deps.db.transaction(async (tx) => {
    const draft = await repo.lockStructure(tx, auth.companyId, id);
    if (!draft) throw notFound();
    if (draft.status !== 'draft') throw invalidTransition(draft.status, 'approve');
    if (draft.version !== input.version) throw versionConflict();

    const approved = await repo.lockApprovedStructures(tx, auth.companyId, draft.employeeId);
    if (approved.some((s) => s.effectiveFrom > draft.effectiveFrom))
      throw ruleViolation('A later salary structure is already approved for this employee.', [
        { path: '/effectiveFrom', code: 'later_structure_exists', message: 'A later structure exists.' },
      ]);
    const sameStart = approved.find((s) => s.effectiveFrom === draft.effectiveFrom) ?? null;
    const previous =
      approved.find(
        (s) =>
          s.effectiveFrom < draft.effectiveFrom &&
          (s.effectiveTo === null || s.effectiveTo >= draft.effectiveFrom),
      ) ?? null;
    const who = { updatedAt: now, updatedBy: auth.userId };

    await withDbErrors(async () => {
      if (sameStart) await repo.updateStructure(tx, sameStart.id, { status: 'superseded', ...who });
      if (previous)
        await repo.updateStructure(tx, previous.id, {
          effectiveTo: addDays(draft.effectiveFrom, -1),
          ...who,
        });
      const row = await repo.updateStructure(
        tx,
        id,
        { status: 'approved', approvedAt: now, approvedBy: auth.userId, ...who },
        input.version,
      );
      if (!row) throw versionConflict();
    });

    const replaced = sameStart ?? previous;
    await repo.insertEmploymentEvent(tx, {
      id: uuidv7(),
      companyId: auth.companyId,
      employeeId: draft.employeeId,
      type: 'salary_changed',
      effectiveDate: draft.effectiveFrom,
      // DATA-MODEL §4: the event references the structure but never copies the amount.
      status: 'applied',
      appliedAt: now,
      changes: { salaryStructureId: { from: replaced?.id ?? null, to: id } },
      reason: draft.reason,
      createdBy: auth.userId,
    });
    await recordAudit(tx, auth.actor, {
      action: 'salary_structure.approved',
      category: 'payroll',
      entityType: 'salary_structure',
      entityId: id,
      employeeId: draft.employeeId,
      metadata: {
        from: 'draft',
        to: 'approved',
        grossAmount: { from: replaced?.grossAmount ?? null, to: draft.grossAmount },
        effectiveFrom: draft.effectiveFrom,
        ...(previous ? { closedStructureId: previous.id } : {}),
        ...(sameStart ? { supersededStructureId: sameStart.id } : {}),
      },
    });
  });
  return reload(deps, auth, id);
}
