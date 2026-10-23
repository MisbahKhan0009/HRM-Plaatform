import type {
  CreateEmployeeInput,
  CreateEmploymentContractInput,
  CreateEmploymentEventInput,
  EffectiveActionInput,
  EmployeeListQuery,
  EmployeeRequirableField,
  EmploymentEventType,
  FieldError,
  HireEmployeeInput,
  SeparateEmployeeInput,
  UpdateEmployeeContactInput,
  UpdateEmployeeInput,
  UpdateEmploymentContractInput,
  VersionOnlyInput,
} from '@hrm/contracts';
import { type Tx, uuidv7 } from '@hrm/db';
import {
  ACTION_EVENT_TYPE,
  appliesNow,
  EFFECTIVE_DATED_ACTIONS,
  type EmployeeAction,
  type EventChanges,
  eventUpdates,
  nextEmployeeStatus,
  toBusinessDate,
} from '@hrm/domain';
import { changes, recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import { nextCodeNumber, padded } from '../../lib/codes';
import { withDbErrors } from '../../lib/db-errors';
import type { Deps } from '../../lib/deps';
import { defined } from '../../lib/dto';
import { requireFresh } from '../../lib/guards';
import { type PageQuery, pageMeta } from '../../lib/pagination';
import {
  AppError,
  invalidTransition,
  notFound,
  ruleViolation,
  validationFailed,
  versionConflict,
} from '../../lib/problem';
import { getSettings } from '../../lib/settings';
import { reassignPendingSteps } from '../approvals/approvals.service';
import { toContact, toContract, toEmployeeBasicFromList, toEmployeeDetail, toEvent } from './employees.dto';
import { employeesPolicy as policy } from './employees.policy';
import * as repo from './employees.repository';

/** Unique constraints of `employees` mapped to catalogue codes (API-STANDARDS §7). */
export const EMPLOYEE_CONSTRAINTS = {
  employees_work_email_uq: { code: 'WORK_EMAIL_TAKEN', path: '/workEmail' },
  employees_code_uq: { code: 'DUPLICATE', path: '/employeeCode' },
  employees_user_id_unique: { code: 'EMPLOYEE_ALREADY_LINKED', path: '/userId' },
} as const;

const fieldError = (path: string, code: string, message: string): FieldError => ({ path, code, message });

/** `employees.required_fields` (BUSINESS-RULES §9): each listed field must hold a value. */
function missingRequired(
  values: Partial<Record<EmployeeRequirableField, unknown>>,
  required: readonly EmployeeRequirableField[],
  onlyPresent: boolean,
): FieldError[] {
  return required
    .filter((f) => (onlyPresent ? values[f] === null : values[f] === null || values[f] === undefined))
    .map((f) => fieldError(`/${f}`, 'required', 'Required.'));
}

/** Department, position and manager must exist in the caller's company. */
async function assertReferences(
  deps: Deps,
  companyId: string,
  refs: { departmentId?: string | null; positionId?: string | null; managerId?: string | null },
) {
  const errors: FieldError[] = [];
  const [dep, pos, man] = await Promise.all([
    refs.departmentId ? repo.departmentExists(deps.db, companyId, refs.departmentId) : true,
    refs.positionId ? repo.positionExists(deps.db, companyId, refs.positionId) : true,
    refs.managerId ? repo.employeeExists(deps.db, companyId, refs.managerId) : true,
  ]);
  if (!dep) errors.push(fieldError('/departmentId', 'not_found', 'Department not found.'));
  if (!pos) errors.push(fieldError('/positionId', 'not_found', 'Position not found.'));
  if (!man) errors.push(fieldError('/managerId', 'not_found', 'Manager not found.'));
  if (errors.length) throw validationFailed(errors);
}

/** SELF_MANAGER, then REPORTING_CYCLE (BUSINESS-RULES §7.1). */
async function assertManager(tx: Tx, employeeId: string, managerId: string | null | undefined) {
  if (!managerId) return;
  if (managerId === employeeId)
    throw new AppError('SELF_MANAGER', 'Self manager', 'An employee cannot be their own manager.');
  if (await repo.wouldCreateCycle(tx, employeeId, managerId))
    throw new AppError('REPORTING_CYCLE', 'Reporting cycle', 'This manager reports to the employee.');
}

function assertProbation(joiningDate: string | null, probationEndDate: string | null) {
  if (joiningDate && probationEndDate && probationEndDate <= joiningDate)
    throw validationFailed([
      fieldError('/probationEndDate', 'date_before_start', 'Probation must end after the joining date.'),
    ]);
}

const stampBy = (auth: AuthContext, now: Date) => ({ updatedBy: auth.userId, updatedAt: now });

// Read --------------------------------------------------------------------------------------------------------------

export async function listEmployees(deps: Deps, auth: AuthContext, query: EmployeeListQuery) {
  const scope = await policy.listScope(auth);
  const { rows, total } = await repo.listEmployees(deps.db, scope, query);
  return { data: rows.map(toEmployeeBasicFromList), page: pageMeta(query, total) };
}

export async function getEmployee(deps: Deps, auth: AuthContext, id: string) {
  const view = await policy.view(auth, id);
  if (!view) throw notFound();
  const row = await repo.findEmployeeDetail(deps.db, auth.companyId, id);
  if (!row) throw notFound();
  return toEmployeeDetail(row, view);
}

async function fullEmployee(deps: Deps, auth: AuthContext, id: string) {
  const row = await repo.findEmployeeDetail(deps.db, auth.companyId, id);
  if (!row) throw notFound();
  return toEmployeeDetail(row, 'full');
}

/** `GET /me/profile`: the caller's own record, from the session (FR-ATT-012 pattern). */
export async function getMyProfile(deps: Deps, auth: AuthContext) {
  policy.readOwn(auth);
  if (!auth.employeeId) throw notFound();
  const row = await repo.findEmployeeDetail(deps.db, auth.companyId, auth.employeeId);
  if (!row) throw notFound();
  return toEmployeeDetail(row, 'self');
}

// Create and update -------------------------------------------------------------------------------------------------

/** Creates a `draft` employee with the next code (US-EMP-001, BUSINESS-RULES §8). */
export async function createEmployee(deps: Deps, auth: AuthContext, input: CreateEmployeeInput) {
  policy.manage(auth);
  const settings = await getSettings(deps.db, auth.companyId, [
    'employees.code_prefix',
    'employees.code_padding',
    'employees.required_fields',
  ]);
  const missing = missingRequired(input, settings['employees.required_fields'], false);
  if (missing.length) throw validationFailed(missing);
  assertProbation(input.joiningDate ?? null, input.probationEndDate ?? null);
  await assertReferences(deps, auth.companyId, input);

  const id = uuidv7();
  await deps.db.transaction(async (tx) => {
    const n = await nextCodeNumber(tx, auth.companyId, 'employee');
    const employeeCode = padded(settings['employees.code_prefix'], n, settings['employees.code_padding']);
    await withDbErrors(
      () =>
        repo.insertEmployees(tx, [
          {
            id,
            companyId: auth.companyId,
            employeeCode,
            firstName: input.firstName,
            lastName: input.lastName,
            preferredName: input.preferredName ?? null,
            workEmail: input.workEmail ?? null,
            workPhone: input.workPhone ?? null,
            dateOfBirth: input.dateOfBirth ?? null,
            gender: input.gender ?? null,
            departmentId: input.departmentId ?? null,
            positionId: input.positionId ?? null,
            managerId: input.managerId ?? null,
            joiningDate: input.joiningDate ?? null,
            probationEndDate: input.probationEndDate ?? null,
            status: 'draft',
            createdBy: auth.userId,
            updatedBy: auth.userId,
          },
        ]),
      EMPLOYEE_CONSTRAINTS,
    );
    await recordAudit(tx, auth.actor, {
      action: 'employee.created',
      category: 'business',
      entityType: 'employee',
      entityId: id,
      employeeId: id,
      metadata: { employeeCode, status: 'draft' },
    });
  });
  return fullEmployee(deps, auth, id);
}

/** Event type recorded when a profile edit changes the organization placement of a hired employee. */
function placementEventType(fields: readonly string[]): EmploymentEventType | null {
  if (fields.includes('departmentId')) return 'transferred';
  if (fields.includes('positionId')) return 'position_changed';
  if (fields.includes('managerId')) return 'manager_changed';
  return null;
}

/**
 * Edits non-lifecycle fields (API-CATALOGUE §4). A manager change runs the SELF_MANAGER and REPORTING_CYCLE checks
 * and re-assigns the employee's pending approval steps. Placement changes of a hired employee are also recorded as an
 * applied employment event dated today, so the history stays complete (FR-EMP-005).
 */
export async function updateEmployee(deps: Deps, auth: AuthContext, id: string, input: UpdateEmployeeInput) {
  policy.manage(auth);
  const { version, ...fields } = input;
  const required = (await getSettings(deps.db, auth.companyId, ['employees.required_fields']))[
    'employees.required_fields'
  ];
  const missing = missingRequired(fields, required, true);
  if (missing.length) throw validationFailed(missing);
  await assertReferences(deps, auth.companyId, fields);

  await deps.db.transaction(async (tx) => {
    const before = await repo.lockEmployee(tx, auth.companyId, id);
    if (!before) throw notFound();
    if (before.status === 'archived') throw invalidTransition(before.status, 'edit');
    const managerChanged = fields.managerId !== undefined && fields.managerId !== before.managerId;
    if (managerChanged) await assertManager(tx, id, fields.managerId);
    const merged = { ...before, ...defined(fields) };
    assertProbation(merged.joiningDate, merged.probationEndDate);
    const now = deps.clock.now();

    const row = await withDbErrors(
      () =>
        repo.updateEmployee(tx, auth.companyId, id, version, { ...defined(fields), ...stampBy(auth, now) }),
      EMPLOYEE_CONSTRAINTS,
    );
    if (!row) throw versionConflict();
    const diff = changes(before, row, Object.keys(fields));
    if (managerChanged) await reassignPendingSteps(tx, auth.companyId, id, now);

    const placement = (['departmentId', 'positionId', 'managerId'] as const).filter((f) => f in diff);
    const type = placementEventType(placement);
    if (type && !['draft', 'preboarding'].includes(before.status)) {
      const eventChanges: EventChanges = {};
      for (const f of placement) eventChanges[f] = diff[f];
      const event = await repo.insertEvent(tx, {
        id: uuidv7(),
        companyId: auth.companyId,
        employeeId: id,
        type,
        effectiveDate: toBusinessDate(now),
        status: 'applied',
        changes: eventChanges,
        appliedAt: now,
        createdBy: auth.userId,
      });
      await recordAudit(tx, auth.actor, {
        action: 'employment_event.created',
        category: 'business',
        entityType: 'employment_event',
        entityId: event.id,
        employeeId: id,
        metadata: { type, effectiveDate: event.effectiveDate, status: 'applied' },
      });
    }
    await recordAudit(tx, auth.actor, {
      action: 'employee.updated',
      category: 'business',
      entityType: 'employee',
      entityId: id,
      employeeId: id,
      metadata: { changes: diff },
    });
  });
  return fullEmployee(deps, auth, id);
}

// Lifecycle (DOMAIN-MODEL §5.2) -------------------------------------------------------------------------------------

type ActionInput =
  | { action: 'start_preboarding' | 'archive'; input: VersionOnlyInput }
  | { action: 'confirm' | 'start_notice' | 'rehire'; input: EffectiveActionInput }
  | { action: 'hire'; input: HireEmployeeInput }
  | { action: 'separate'; input: SeparateEmployeeInput };

const ACTION_VERB: Record<EmployeeAction, string> = {
  start_preboarding: 'start preboarding',
  hire: 'hire',
  confirm: 'confirm',
  start_notice: 'start notice',
  separate: 'separate',
  rehire: 'rehire',
  archive: 'archive',
};

/**
 * Runs a lifecycle action. Effective-dated actions write an `employment_events` row: today or earlier is applied
 * at once, a future date is `scheduled` and applied by the daily job (JOBS-AND-OUTBOX §3). Only one status change
 * may wait at a time. `separate` needs a fresh strong session (API-CATALOGUE §4).
 */
export async function runLifecycleAction(deps: Deps, auth: AuthContext, id: string, cmd: ActionInput) {
  policy.manage(auth);
  const now = deps.clock.now();
  if (cmd.action === 'separate') requireFresh(auth, now);
  const today = toBusinessDate(now);

  await deps.db.transaction(async (tx) => {
    const emp = await repo.lockEmployee(tx, auth.companyId, id);
    if (!emp) throw notFound();
    const withProbation = cmd.action === 'hire' && Boolean(cmd.input.probationEndDate);
    const to = nextEmployeeStatus(emp.status, cmd.action, { withProbation });
    if (!to) throw invalidTransition(emp.status, ACTION_VERB[cmd.action]);
    if (emp.version !== cmd.input.version) throw versionConflict();
    if (await repo.hasScheduledStatusEvent(tx, id))
      throw new AppError(
        'INVALID_TRANSITION',
        'Invalid transition',
        'A status change is already scheduled for this employee.',
      );

    const eventChanges: EventChanges = { status: { from: emp.status, to } };
    let effectiveDate = today;
    const reason = 'reason' in cmd.input ? (cmd.input.reason ?? null) : null;
    switch (cmd.action) {
      case 'hire':
        effectiveDate = cmd.input.effectiveDate;
        eventChanges.joiningDate = { from: emp.joiningDate, to: effectiveDate };
        eventChanges.probationEndDate = {
          from: emp.probationEndDate,
          to: cmd.input.probationEndDate ?? null,
        };
        break;
      case 'confirm':
      case 'start_notice':
        effectiveDate = cmd.input.effectiveDate;
        break;
      case 'rehire':
        // Rehire: same employee code, new joining date; the old dates stay in the event history (DOMAIN-MODEL §5.2).
        effectiveDate = cmd.input.effectiveDate;
        eventChanges.joiningDate = { from: emp.joiningDate, to: effectiveDate };
        eventChanges.separationDate = { from: emp.separationDate, to: null };
        eventChanges.separationType = { from: emp.separationType, to: null };
        break;
      case 'separate':
        effectiveDate = cmd.input.separationDate;
        eventChanges.separationDate = { from: emp.separationDate, to: cmd.input.separationDate };
        eventChanges.separationType = { from: emp.separationType, to: cmd.input.separationType };
        break;
    }
    if (
      cmd.action !== 'hire' &&
      cmd.action !== 'rehire' &&
      emp.joiningDate &&
      effectiveDate < emp.joiningDate
    )
      throw new AppError('INVALID_DATE', 'Invalid date', 'The date is before the joining date.');
    if (cmd.action === 'rehire' && emp.separationDate && effectiveDate <= emp.separationDate)
      throw new AppError('INVALID_DATE', 'Invalid date', 'Rehire must be after the separation date.');

    const applyNow = !EFFECTIVE_DATED_ACTIONS.has(cmd.action) || appliesNow(effectiveDate, today);
    const updates = applyNow
      ? { ...eventUpdates(eventChanges), ...(cmd.action === 'archive' ? { archivedAt: now } : {}) }
      : {};
    const row = await repo.updateEmployee(tx, auth.companyId, id, cmd.input.version, {
      ...(updates as Partial<repo.EmployeeRow>),
      ...stampBy(auth, now),
    });
    if (!row) throw versionConflict();
    const event = await repo.insertEvent(tx, {
      id: uuidv7(),
      companyId: auth.companyId,
      employeeId: id,
      type: ACTION_EVENT_TYPE[cmd.action],
      effectiveDate,
      status: applyNow ? 'applied' : 'scheduled',
      changes: eventChanges,
      reason,
      appliedAt: applyNow ? now : null,
      createdBy: auth.userId,
    });
    await recordAudit(tx, auth.actor, {
      action: 'employment_event.created',
      category: 'business',
      entityType: 'employment_event',
      entityId: event.id,
      employeeId: id,
      metadata: { type: event.type, effectiveDate, status: event.status },
    });
    if (applyNow) {
      await recordAudit(tx, auth.actor, {
        action: cmd.action === 'archive' ? 'employee.archived' : 'employee.status_changed',
        category: 'business',
        entityType: 'employee',
        entityId: id,
        employeeId: id,
        metadata: { from: emp.status, to, effectiveDate },
      });
    }
  });
  return fullEmployee(deps, auth, id);
}

// Employment events (FR-EMP-005) ------------------------------------------------------------------------------------

export async function listHistory(deps: Deps, auth: AuthContext, id: string, page: PageQuery) {
  const access = await policy.historyAccess(auth, id);
  if (!access || !(await repo.employeeExists(deps.db, auth.companyId, id))) throw notFound();
  const { rows, total } = await repo.listEvents(deps.db, id, page, access);
  return { data: rows.map((r) => toEvent(r.event, r.creatorName)), page: pageMeta(page, total) };
}

/** Promotion, transfer, manager or position change; a future date is scheduled for the daily job. */
export async function createEmploymentEvent(
  deps: Deps,
  auth: AuthContext,
  id: string,
  input: CreateEmploymentEventInput,
) {
  policy.manage(auth);
  await assertReferences(deps, auth.companyId, input);
  const now = deps.clock.now();
  const today = toBusinessDate(now);

  const event = await deps.db.transaction(async (tx) => {
    const emp = await repo.lockEmployee(tx, auth.companyId, id);
    if (!emp) throw notFound();
    if (emp.status === 'archived') throw invalidTransition(emp.status, 'change');
    if (input.managerId !== undefined) await assertManager(tx, id, input.managerId);

    const eventChanges: EventChanges = {};
    for (const f of ['departmentId', 'positionId', 'managerId'] as const) {
      const to = input[f];
      if (to !== undefined && to !== emp[f]) eventChanges[f] = { from: emp[f], to };
    }
    if (!Object.keys(eventChanges).length) throw ruleViolation('The event changes nothing.');

    const applyNow = appliesNow(input.effectiveDate, today);
    const row = await repo.insertEvent(tx, {
      id: uuidv7(),
      companyId: auth.companyId,
      employeeId: id,
      type: input.type,
      effectiveDate: input.effectiveDate,
      status: applyNow ? 'applied' : 'scheduled',
      changes: eventChanges,
      reason: input.reason ?? null,
      appliedAt: applyNow ? now : null,
      createdBy: auth.userId,
    });
    if (applyNow) {
      await repo.updateEmployee(tx, auth.companyId, id, null, {
        ...(eventUpdates(eventChanges) as Partial<repo.EmployeeRow>),
        ...stampBy(auth, now),
      });
      if (eventChanges.managerId) await reassignPendingSteps(tx, auth.companyId, id, now);
    }
    await recordAudit(tx, auth.actor, {
      action: 'employment_event.created',
      category: 'business',
      entityType: 'employment_event',
      entityId: row.id,
      employeeId: id,
      metadata: {
        type: row.type,
        effectiveDate: row.effectiveDate,
        status: row.status,
        changes: eventChanges,
      },
    });
    return row;
  });
  return toEvent(event, auth.user.name);
}

// Contact (SECURITY-MODEL §5; AUDIT.md §3-§4) -----------------------------------------------------------------------

/** Reading restricted contact data is audited (`employee.contact_viewed`). */
export async function getContact(deps: Deps, auth: AuthContext, id: string) {
  if (!policy.readContact(auth, id) || !(await repo.employeeExists(deps.db, auth.companyId, id)))
    throw notFound();
  const row = await repo.findContact(deps.db, id);
  await recordAudit(deps.db, auth.actor, {
    action: 'employee.contact_viewed',
    category: 'business',
    entityType: 'employee',
    entityId: id,
    employeeId: id,
    metadata: { own: auth.employeeId === id },
  });
  return toContact(id, row);
}

/** Updates contact data; the audit row lists field names only, never values (AUDIT.md §4). */
export async function updateContact(
  deps: Deps,
  auth: AuthContext,
  id: string,
  input: UpdateEmployeeContactInput,
) {
  policy.manage(auth);
  const { version, ...fields } = input;
  return deps.db.transaction(async (tx) => {
    if (!(await repo.lockEmployee(tx, auth.companyId, id))) throw notFound();
    const now = deps.clock.now();
    const before = await repo.findContact(tx, id);
    const values = defined(fields);
    const row =
      version === 0
        ? await repo.insertContact(tx, {
            employeeId: id,
            ...values,
            createdBy: auth.userId,
            updatedBy: auth.userId,
          })
        : await repo.updateContact(tx, id, version, { ...values, ...stampBy(auth, now) });
    if (!row) throw versionConflict();
    const changed = Object.keys(changes(before ?? {}, row, Object.keys(values)));
    await recordAudit(tx, auth.actor, {
      action: 'employee.contact_updated',
      category: 'business',
      entityType: 'employee',
      entityId: id,
      employeeId: id,
      metadata: { fields: changed },
    });
    return toContact(id, row);
  });
}

// Contracts (FR-DOC-009) --------------------------------------------------------------------------------------------

async function assertDocument(deps: Deps, auth: AuthContext, employeeId: string, documentId?: string | null) {
  if (documentId && !(await repo.documentOfEmployee(deps.db, auth.companyId, employeeId, documentId)))
    throw validationFailed([fieldError('/documentId', 'not_found', 'Document not found for this employee.')]);
}

export async function listContracts(deps: Deps, auth: AuthContext, id: string, page: PageQuery) {
  if (!policy.readContracts(auth, id) || !(await repo.employeeExists(deps.db, auth.companyId, id)))
    throw notFound();
  const { rows, total } = await repo.listContracts(deps.db, id, page);
  return { data: rows.map(toContract), page: pageMeta(page, total) };
}

export async function createContract(
  deps: Deps,
  auth: AuthContext,
  id: string,
  input: CreateEmploymentContractInput,
) {
  policy.manage(auth);
  if (!(await repo.employeeExists(deps.db, auth.companyId, id))) throw notFound();
  await assertDocument(deps, auth, id, input.documentId);
  return deps.db.transaction(async (tx) => {
    const row = await repo.insertContract(tx, {
      id: uuidv7(),
      companyId: auth.companyId,
      employeeId: id,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      status: input.status ?? 'active',
      documentId: input.documentId ?? null,
      notes: input.notes ?? null,
      createdBy: auth.userId,
      updatedBy: auth.userId,
    });
    await recordAudit(tx, auth.actor, {
      action: 'contract.created',
      category: 'business',
      entityType: 'employment_contract',
      entityId: row.id,
      employeeId: id,
      metadata: { type: row.type, startDate: row.startDate, endDate: row.endDate, status: row.status },
    });
    return toContract(row);
  });
}

export async function updateContract(
  deps: Deps,
  auth: AuthContext,
  id: string,
  contractId: string,
  input: UpdateEmploymentContractInput,
) {
  policy.manage(auth);
  const { version, ...fields } = input;
  const before = await repo.findContract(deps.db, auth.companyId, id, contractId);
  if (!before) throw notFound();
  const merged = { ...before, ...defined(fields) };
  const errors: FieldError[] = [];
  if (merged.endDate && merged.endDate < merged.startDate)
    errors.push(fieldError('/endDate', 'date_before_start', 'End before start.'));
  if (merged.type === 'fixed_term' && !merged.endDate)
    errors.push(fieldError('/endDate', 'required', 'A fixed-term contract needs an end date.'));
  if (errors.length) throw validationFailed(errors);
  await assertDocument(deps, auth, id, fields.documentId);
  return deps.db.transaction(async (tx) => {
    const row = await repo.updateContract(tx, contractId, version, {
      ...defined(fields),
      ...stampBy(auth, deps.clock.now()),
    });
    if (!row) throw versionConflict();
    await recordAudit(tx, auth.actor, {
      action: 'contract.updated',
      category: 'business',
      entityType: 'employment_contract',
      entityId: contractId,
      employeeId: id,
      metadata: { changes: changes(before, row, Object.keys(fields)) },
    });
    return toContract(row);
  });
}
