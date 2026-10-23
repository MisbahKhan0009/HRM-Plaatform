import {
  type AdjustLeaveBalanceInput,
  type BalancesQuery,
  type CreateLeavePolicyInput,
  type CreateLeaveTypeInput,
  type LeaveCalendar,
  type LeaveCalendarEntry,
  type LeaveCalendarQuery,
  type LedgerQuery,
  P,
  type UpdateLeaveTypeInput,
} from '@hrm/contracts';
import { uuidv7 } from '@hrm/db';
import { balanceDelta, canConsume, Decimal, isEligibleOn, leaveYearOf, toBusinessDate } from '@hrm/domain';
import { changes, recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import { withDbErrors } from '../../lib/db-errors';
import type { Deps } from '../../lib/deps';
import { defined } from '../../lib/dto';
import { requireStrong } from '../../lib/guards';
import { pageMeta } from '../../lib/pagination';
import { AppError, forbidden, notFound, validationFailed, versionConflict } from '../../lib/problem';
import { getSetting } from '../../lib/settings';
import { toBalance, toLeaveType, toLedgerEntry, toPolicy } from './leave.dto';
import { leavePolicy as policy } from './leave.policy';
import * as repo from './leave.repository';

const today = (deps: Deps) => toBusinessDate(deps.clock.now());
const who = (auth: AuthContext, now: Date) => ({ updatedBy: auth.userId, updatedAt: now });

// Types -------------------------------------------------------------------------------------------------------------

const TYPE_CONSTRAINTS = { leave_types_code_uq: { code: 'DUPLICATE', path: '/code' } } as const;

/**
 * Active types with the policy in force today (any session). With an employee record, each type also says whether
 * that employee is eligible today, by the rule `POST /leave/requests` applies (BUSINESS-RULES 3.1, 5.1).
 */
export async function listTypes(deps: Deps, auth: AuthContext, includeInactive: boolean) {
  const date = today(deps);
  const [rows, employee] = await Promise.all([
    repo.listTypesWithPolicy(deps.db, auth.companyId, date, includeInactive),
    auth.employeeId ? repo.findEmployee(deps.db, auth.companyId, auth.employeeId) : null,
  ]);
  return rows.map((r) => {
    const dto = toLeaveType(r.type, r.policy);
    if (!employee) return dto;
    const eligible =
      r.type.isActive &&
      r.policy !== null &&
      isEligibleOn(
        {
          status: employee.status,
          joiningDate: employee.joiningDate,
          separationDate: employee.separationDate,
          eligibleStatuses: r.policy.eligibleStatuses,
          eligibilityAfterDays: r.policy.eligibilityAfterDays,
        },
        date,
      );
    return { ...dto, eligible };
  });
}

async function getType(deps: Deps, auth: AuthContext, id: string) {
  const type = await repo.findType(deps.db, auth.companyId, id);
  if (!type) throw notFound();
  return toLeaveType(type, await repo.policyOnDate(deps.db, auth.companyId, id, today(deps)));
}

export async function createType(deps: Deps, auth: AuthContext, input: CreateLeaveTypeInput) {
  policy.managePolicies(auth);
  const id = await deps.db.transaction(async (tx) => {
    const row = await withDbErrors(
      () =>
        repo.insertType(tx, {
          id: uuidv7(),
          companyId: auth.companyId,
          code: input.code,
          name: input.name,
          isPaid: input.isPaid ?? true,
          allowsHalfDay: input.allowsHalfDay ?? true,
          requiresReason: input.requiresReason ?? false,
          requiresDocumentAfterDays: input.requiresDocumentAfterDays ?? null,
          colorToken: input.colorToken ?? null,
          sortOrder: input.sortOrder ?? 0,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        }),
      TYPE_CONSTRAINTS,
    );
    if (!row) throw new Error('insert returned nothing');
    await recordAudit(tx, auth.actor, {
      action: 'leave_type.created',
      category: 'business',
      entityType: 'leave_type',
      entityId: row.id,
      metadata: { code: row.code, name: row.name },
    });
    return row.id;
  });
  return getType(deps, auth, id);
}

export async function updateType(deps: Deps, auth: AuthContext, id: string, input: UpdateLeaveTypeInput) {
  policy.managePolicies(auth);
  const { version, ...fields } = input;
  await deps.db.transaction(async (tx) => {
    const before = await repo.findType(tx, auth.companyId, id);
    if (!before) throw notFound();
    const row = await repo.updateType(tx, auth.companyId, id, version, {
      ...defined(fields),
      ...who(auth, deps.clock.now()),
    });
    if (!row) throw versionConflict();
    await recordAudit(tx, auth.actor, {
      action: 'leave_type.updated',
      category: 'business',
      entityType: 'leave_type',
      entityId: id,
      metadata: { changes: changes(before, row, Object.keys(fields)) },
    });
  });
  return getType(deps, auth, id);
}

// Policies ----------------------------------------------------------------------------------------------------------

export async function listPolicies(deps: Deps, auth: AuthContext, typeId: string) {
  policy.managePolicies(auth);
  if (!(await repo.findType(deps.db, auth.companyId, typeId))) throw notFound();
  return (await repo.listPolicies(deps.db, auth.companyId, typeId)).map(toPolicy);
}

/**
 * New policy version (API-CATALOGUE §6): effective today or later, so balances already posted under the current
 * version never change (US-LEAVE-001). The open-ended current version ends the day before. A version that would
 * overlap a later one is refused (EXCLUDE constraint, 422).
 */
export async function createPolicy(
  deps: Deps,
  auth: AuthContext,
  typeId: string,
  input: CreateLeavePolicyInput,
) {
  policy.managePolicies(auth);
  if (input.effectiveFrom < today(deps))
    throw validationFailed([
      { path: '/effectiveFrom', code: 'in_past', message: 'A new policy version starts today or later.' },
    ]);
  return deps.db.transaction(async (tx) => {
    const type = await repo.findType(tx, auth.companyId, typeId);
    if (!type) throw notFound();
    await repo.closeOpenPolicy(tx, auth.companyId, typeId, input.effectiveFrom, auth.userId);
    const row = await withDbErrors(
      () =>
        repo.insertPolicy(tx, {
          id: uuidv7(),
          companyId: auth.companyId,
          leaveTypeId: typeId,
          effectiveFrom: input.effectiveFrom,
          allocationMethod: input.allocationMethod,
          annualEntitlement: input.annualEntitlement ?? null,
          accrualPerMonth: input.accrualPerMonth ?? null,
          daysWorkedPerUnit: input.daysWorkedPerUnit ?? null,
          prorateFirstYear: input.prorateFirstYear ?? true,
          eligibilityAfterDays: input.eligibilityAfterDays ?? 0,
          ...(input.eligibleStatuses ? { eligibleStatuses: input.eligibleStatuses } : {}),
          maxCarryForward: input.maxCarryForward ?? null,
          maxBalance: input.maxBalance ?? null,
          carryForwardExpiryMonths: input.carryForwardExpiryMonths ?? null,
          allowNegativeBalance: input.allowNegativeBalance ?? false,
          maxConsecutiveDays: input.maxConsecutiveDays ?? null,
          minNoticeDays: input.minNoticeDays ?? 0,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        }),
      { leave_policies_no_overlap: { code: 'BUSINESS_RULE_VIOLATION' } },
    );
    if (!row) throw new Error('insert returned nothing');
    await recordAudit(tx, auth.actor, {
      action: 'leave_policy.created',
      category: 'business',
      entityType: 'leave_policy',
      entityId: row.id,
      metadata: {
        leaveTypeId: typeId,
        effectiveFrom: row.effectiveFrom,
        allocationMethod: row.allocationMethod,
      },
    });
    return toPolicy(row);
  });
}

// Balances and ledger -----------------------------------------------------------------------------------------------

/** `GET /leave/balances/me`: the caller's own employee only (FR-LEAVE-003). */
export async function myBalances(deps: Deps, auth: AuthContext, year?: number) {
  const employeeId = policy.ownEmployee(auth);
  if (!employeeId) throw forbidden();
  const y = year ?? leaveYearOf(today(deps));
  const rows = await repo.employeeBalances(deps.db, auth.companyId, employeeId, y);
  return { year: y, data: rows.map((r) => toBalance(r, y)) };
}

export async function listBalances(deps: Deps, auth: AuthContext, q: BalancesQuery) {
  const scope = await policy.readScope(auth);
  if (!scope) throw forbidden();
  const year = q.year ?? leaveYearOf(today(deps));
  const { rows, total } = await repo.listBalances(deps.db, scope, { ...q, year }, q);
  return { data: rows.map((r) => toBalance(r, year)), page: pageMeta(q, total) };
}

export async function ledger(deps: Deps, auth: AuthContext, employeeId: string, q: LedgerQuery) {
  const scope = await policy.viewScope(auth);
  const visible =
    scope && (scope.employees === 'all' || (scope.employees as readonly string[]).includes(employeeId));
  if (!visible || !(await repo.findEmployee(deps.db, auth.companyId, employeeId))) throw notFound();
  const year = q.year ?? leaveYearOf(today(deps));
  const { rows, total } = await repo.listLedger(deps.db, auth.companyId, employeeId, { ...q, year });
  return { data: rows.map(toLedgerEntry), page: pageMeta(q, total) };
}

/**
 * HR adjustment (US-LEAVE-007, BUSINESS-RULES 4.1): `adjustment ±a` with a reason, on the locked balance row, audited
 * as `leave_balance.adjusted`. A negative adjustment may not take `available` below zero unless the policy allows it.
 */
export async function adjustBalance(deps: Deps, auth: AuthContext, input: AdjustLeaveBalanceInput) {
  policy.adjustBalances(auth);
  requireStrong(auth);
  const [employee, type] = await Promise.all([
    repo.findEmployee(deps.db, auth.companyId, input.employeeId),
    repo.findType(deps.db, auth.companyId, input.leaveTypeId),
  ]);
  if (!employee)
    throw validationFailed([{ path: '/employeeId', code: 'not_found', message: 'Employee not found.' }]);
  if (!type)
    throw validationFailed([{ path: '/leaveTypeId', code: 'not_found', message: 'Leave type not found.' }]);
  const amount = new Decimal(input.amount);
  await deps.db.transaction(async (tx) => {
    const governing = await repo.policyForYear(tx, auth.companyId, type.id, input.year);
    const key = {
      companyId: auth.companyId,
      employeeId: employee.id,
      leaveTypeId: type.id,
      year: input.year,
    };
    const balance = await repo.lockBalance(tx, key);
    if (
      amount.isNeg() &&
      !canConsume(balance.available ?? '0', amount.neg(), governing?.allowNegativeBalance ?? false)
    )
      throw new AppError(
        'INSUFFICIENT_BALANCE',
        'Not enough leave balance',
        `Adjustment of ${amount.toFixed(2)} days exceeds the ${balance.available} days available.`,
      );
    const postings = [{ type: 'adjustment' as const, amount }];
    // Dated today within the current year; the year's last (past year) or first (future year) day otherwise.
    const todayDate = today(deps);
    const currentYear = leaveYearOf(todayDate);
    const effectiveDate =
      input.year === currentYear
        ? todayDate
        : input.year < currentYear
          ? `${input.year}-12-31`
          : `${input.year}-01-01`;
    const [entry] = await repo.post(
      tx,
      {
        ...key,
        effectiveDate,
        policyId: governing?.id ?? null,
        reason: input.reason,
        createdBy: auth.userId,
      },
      postings,
      balanceDelta('adjustment', amount),
    );
    await recordAudit(tx, auth.actor, {
      action: 'leave_balance.adjusted',
      category: 'business',
      entityType: 'leave_balance',
      entityId: entry?.id ?? null,
      employeeId: employee.id,
      metadata: {
        leaveTypeId: type.id,
        leaveTypeCode: type.code,
        year: input.year,
        amount: amount.toFixed(2),
        reason: input.reason,
      },
    });
  });
  const row = await repo.balanceRow(deps.db, auth.companyId, employee.id, type.id, input.year);
  if (!row) throw notFound();
  return toBalance(row, input.year);
}

// Calendar ----------------------------------------------------------------------------------------------------------

/**
 * Leave calendar (FR-LEAVE-011, US-LEAVE-008): readers with `leave.read.*` see their scope with types; employees see
 * their own leave and, only when `leave.calendar.visible_to_team` is on, colleagues' approved leave with name and
 * dates only.
 */
export async function calendar(deps: Deps, auth: AuthContext, q: LeaveCalendarQuery): Promise<LeaveCalendar> {
  const active = ['pending', 'approved', 'cancellation_pending'] as const;
  const out: LeaveCalendarEntry[] = [];
  const seen = new Set<string>();
  const full = (r: Awaited<ReturnType<typeof repo.calendarEntries>>[number]): LeaveCalendarEntry => ({
    requestId: r.id,
    employeeId: r.employeeId,
    employeeName: r.employeeName,
    startDate: r.startDate,
    endDate: r.endDate,
    unit: r.unit,
    halfDayPart: r.halfDayPart,
    status: r.status as LeaveCalendarEntry['status'],
    leaveType: { id: r.typeId, code: r.typeCode, name: r.typeName, colorToken: r.typeColor },
  });

  const readScope = await policy.readScope(auth);
  const own = policy.ownEmployee(auth);
  if (!readScope && !own) throw forbidden();
  const scope = readScope ?? auth.scopeOwn();
  // The department filter is for company-wide readers; team readers and employees keep their own view.
  const departmentId = q.departmentId && auth.can(P.leave.read.all) ? q.departmentId : undefined;
  for (const r of await repo.calendarEntries(deps.db, scope, q, active, departmentId)) {
    seen.add(r.id);
    out.push(full(r));
  }
  if (!readScope && own && (await getSetting(deps.db, auth.companyId, 'leave.calendar.visible_to_team'))) {
    const peers = await repo.peerIds(deps.db, auth.companyId, own);
    if (peers.length) {
      const rows = await repo.calendarEntries(deps.db, { companyId: auth.companyId, employees: peers }, q, [
        'approved',
      ]);
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        out.push({
          employeeId: r.employeeId,
          employeeName: r.employeeName,
          startDate: r.startDate,
          endDate: r.endDate,
          unit: r.unit,
          halfDayPart: r.halfDayPart,
          status: 'approved',
        });
      }
    }
  }
  out.sort((a, b) => (a.startDate === b.startDate ? 0 : a.startDate < b.startDate ? -1 : 1));
  return { from: q.from, to: q.to, data: out };
}
