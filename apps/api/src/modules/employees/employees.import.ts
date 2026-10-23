import {
  type EmployeeImportCommitInput,
  type EmployeeImportPreview,
  type EmployeeImportPreviewInput,
  type EmployeeImportResult,
  IMPORT_MAX_ROWS,
} from '@hrm/contracts';
import { type schema, uuidv7 } from '@hrm/db';
import {
  EFFECTIVE_DATED_ACTIONS,
  eventUpdates,
  type ImportValidation,
  importedEmployment,
  parseCsv,
  toBusinessDate,
  validateImport,
} from '@hrm/domain';
import { type AuditEvent, recordAudit, recordAudits } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import { padded } from '../../lib/codes';
import { sha256Hex } from '../../lib/crypto';
import { withDbErrors } from '../../lib/db-errors';
import type { Deps } from '../../lib/deps';
import { validationFailed } from '../../lib/problem';
import { getSettings } from '../../lib/settings';
import { employeesPolicy as policy } from './employees.policy';
import * as repo from './employees.repository';
import { EMPLOYEE_CONSTRAINTS } from './employees.service';

const PARSE_MESSAGES = {
  UNTERMINATED_QUOTE: 'A quoted value is not closed.',
  TOO_MANY_ROWS: `At most ${IMPORT_MAX_ROWS} rows per import.`,
  EMPTY: 'The file has no rows.',
} as const;

/**
 * Parses and validates an import (FR-EMP-008). Stateless: nothing is stored between preview and commit, so the
 * commit repeats this with the same CSV. One pass over at most 500 rows plus three lookup queries, inside the
 * Worker's CPU budget (ADR-0009).
 */
async function validate(
  deps: Deps,
  auth: AuthContext,
  input: { csv: string; mapping?: EmployeeImportPreviewInput['mapping'] },
  today: string,
): Promise<ImportValidation> {
  const parsed = parseCsv(input.csv, IMPORT_MAX_ROWS + 1);
  if (!parsed.ok)
    throw validationFailed([
      { path: '/csv', code: parsed.reason.toLowerCase(), message: PARSE_MESSAGES[parsed.reason] },
    ]);
  const [lookups, settings] = await Promise.all([
    repo.importLookups(deps.db, auth.companyId),
    getSettings(deps.db, auth.companyId, ['employees.required_fields']),
  ]);
  return validateImport(parsed.rows, input.mapping, {
    ...lookups,
    requiredFields: settings['employees.required_fields'],
    today,
  });
}

/** Preview: mapping, per-row errors and duplicates; nothing is saved. */
export async function previewImport(
  deps: Deps,
  auth: AuthContext,
  input: EmployeeImportPreviewInput,
): Promise<EmployeeImportPreview> {
  policy.manage(auth);
  const result = await validate(deps, auth, input, toBusinessDate(deps.clock.now()));
  const valid = result.rows.filter((r) => r.valid).length;
  return {
    previewToken: await sha256Hex(input.csv),
    mapping: result.mapping,
    totalRows: result.rows.length,
    validRows: valid,
    invalidRows: result.rows.length - valid,
    rows: result.rows.map((r) => ({
      row: r.row,
      valid: r.valid,
      employeeCode: r.value.employeeCode,
      name: `${r.value.firstName} ${r.value.lastName}`.trim(),
    })),
    duplicates: result.rows.filter((r) => r.duplicate).map((r) => r.row),
    errors: result.issues,
  };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Commit: re-validates the same CSV (the token proves it is the previewed file) and creates the valid rows in one
 * transaction; rows with errors are reported, not saved (US-EMP-007). Imported staff are already employed
 * (BUSINESS-RULES §10): each row walks the DOMAIN-MODEL §5.2 transitions from `draft` to `active` or `probation`, and
 * its `hired` (and `confirmed`) events are recorded as applied on their historical dates, with the same audit rows the
 * lifecycle actions write. Imported codes keep their value and the sequence moves above them; rows without a code get
 * the next codes (BUSINESS-RULES §8).
 */
export async function commitImport(
  deps: Deps,
  auth: AuthContext,
  input: EmployeeImportCommitInput,
): Promise<EmployeeImportResult> {
  policy.manage(auth);
  if ((await sha256Hex(input.csv)) !== input.previewToken)
    throw validationFailed([
      { path: '/previewToken', code: 'mismatch', message: 'The file differs from the previewed file.' },
    ]);
  const now = deps.clock.now();
  const today = toBusinessDate(now);
  const result = await validate(deps, auth, input, today);
  const headerIssues = result.issues.filter((i) => i.row === 0);
  if (headerIssues.length)
    throw validationFailed(headerIssues.map(({ path, code, message }) => ({ path, code, message })));
  const errors = result.issues;
  const rows = result.rows.filter((r) => r.valid);
  if (!rows.length) return { createdCount: 0, skippedCount: result.rows.length, created: [], errors };

  const settings = await getSettings(deps.db, auth.companyId, [
    'employees.code_prefix',
    'employees.code_padding',
  ]);
  const prefix = settings['employees.code_prefix'];
  const numbered = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`);

  return deps.db.transaction(async (tx) => {
    const highest = Math.max(
      0,
      ...rows.map((r) => Number(numbered.exec(r.value.employeeCode ?? '')?.[1] ?? 0)),
    );
    if (highest > 0) await repo.raiseCodeSequence(tx, auth.companyId, highest + 1);
    const codeless = rows.filter((r) => !r.value.employeeCode).length;
    let next = codeless ? await repo.reserveCodeNumbers(tx, auth.companyId, codeless) : 0;

    const planned = rows.map((r) => ({
      row: r,
      id: uuidv7(),
      code: r.value.employeeCode ?? padded(prefix, next++, settings['employees.code_padding']),
      // Validation guarantees a joining date on or before today for every valid row.
      employment: importedEmployment({
        joiningDate: r.value.joiningDate as string,
        probationEndDate: r.value.probationEndDate,
        today,
      }),
    }));
    const idByCode = new Map(planned.map((p) => [p.code, p.id]));
    const values: (typeof schema.employees.$inferInsert)[] = planned.map(
      ({ row: { value: v }, id, code, employment }) => ({
        id,
        companyId: auth.companyId,
        employeeCode: code,
        firstName: v.firstName,
        lastName: v.lastName,
        preferredName: v.preferredName,
        workEmail: v.workEmail,
        workPhone: v.workPhone,
        dateOfBirth: v.dateOfBirth,
        gender: v.gender,
        departmentId: v.departmentId,
        positionId: v.positionId,
        // Rows may name a manager in the same file; one INSERT checks the references at the end of the statement.
        managerId: v.manager
          ? 'id' in v.manager
            ? v.manager.id
            : (idByCode.get(v.manager.rowCode) ?? null)
          : null,
        // Status, joining date and probation end come from the lifecycle steps, applied in order from `draft`.
        status: 'draft',
        joiningDate: null,
        probationEndDate: null,
        ...(Object.assign({}, ...employment.steps.map((s) => eventUpdates(s.changes))) as Partial<
          typeof schema.employees.$inferInsert
        >),
        createdBy: auth.userId,
        updatedBy: auth.userId,
      }),
    );
    await withDbErrors(() => repo.insertEmployees(tx, values), EMPLOYEE_CONSTRAINTS);

    // Effective-dated steps (`hire`, `confirm`) become applied employment events, as the lifecycle actions record
    // them; the passage through `preboarding` happens within the same statement and has no event of its own.
    const events = planned.flatMap(({ id, employment }) =>
      employment.steps
        .filter((s) => EFFECTIVE_DATED_ACTIONS.has(s.action))
        .map((s) => ({
          id: uuidv7(),
          companyId: auth.companyId,
          employeeId: id,
          type: s.type,
          effectiveDate: s.effectiveDate,
          status: 'applied' as const,
          changes: s.changes,
          reason: null,
          appliedAt: now,
          createdBy: auth.userId,
        })),
    );
    await repo.insertEvents(tx, events);
    const audits: AuditEvent[] = events.flatMap((e) => [
      {
        action: 'employment_event.created',
        category: 'business',
        entityType: 'employment_event',
        entityId: e.id,
        employeeId: e.employeeId,
        metadata: { type: e.type, effectiveDate: e.effectiveDate, status: e.status },
      },
      {
        action: 'employee.status_changed',
        category: 'business',
        entityType: 'employee',
        entityId: e.employeeId,
        employeeId: e.employeeId,
        metadata: { ...e.changes.status, effectiveDate: e.effectiveDate },
      },
    ]);
    await recordAudits(tx, auth.actor, audits);

    const byStatus = { active: 0, probation: 0 } as Record<string, number>;
    for (const p of planned) byStatus[p.employment.status] = (byStatus[p.employment.status] ?? 0) + 1;
    await recordAudit(tx, auth.actor, {
      action: 'employee.imported',
      category: 'business',
      entityType: 'employee_import',
      entityId: null,
      metadata: {
        createdCount: planned.length,
        skippedCount: result.rows.length - planned.length,
        byStatus,
        employeeIds: planned.map((p) => p.id),
      },
    });
    return {
      createdCount: planned.length,
      skippedCount: result.rows.length - planned.length,
      created: planned.map((p) => ({
        row: p.row.row,
        id: p.id,
        employeeCode: p.code,
        status: p.employment.status,
      })),
      errors,
    };
  });
}
