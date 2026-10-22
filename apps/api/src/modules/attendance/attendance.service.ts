import type {
  AttendanceDayDetail,
  AttendanceEvent,
  AttendanceListQuery,
  AttendanceRecord,
  AttendanceSummaryQuery,
  AttendanceSummaryRow,
  AttendanceToday,
  CreateManualEntryInput,
  MyAttendanceQuery,
  MyAttendanceResponse,
  PunchResult,
} from '@hrm/contracts';
import { type Queryable, type schema, type Tx, uuidv7 } from '@hrm/db';
import { addDays, computeAttendanceDay, toBusinessDate, weekday } from '@hrm/domain';
import { recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import type { Deps } from '../../lib/deps';
import { isoOrNull } from '../../lib/dto';
import { pageMeta, pageOffset } from '../../lib/pagination';
import { AppError, notFound, ruleViolation, validationFailed } from '../../lib/problem';
import { rateLimit } from '../../lib/rate-limit';
import { getSetting } from '../../lib/settings';
import { attendancePolicy as policy } from './attendance.policy';
import * as repo from './attendance.repository';

// Mappers -----------------------------------------------------------------------------------------------------------

export function toRecord(row: repo.RecordRow): AttendanceRecord {
  const r = row.r;
  return {
    id: r.id,
    employee: { id: r.employeeId, employeeCode: row.employeeCode, name: row.employeeName },
    workDate: r.workDate,
    status: r.status,
    firstInAt: isoOrNull(r.firstInAt),
    lastOutAt: isoOrNull(r.lastOutAt),
    workedMinutes: r.workedMinutes,
    lateMinutes: r.lateMinutes,
    earlyLeaveMinutes: r.earlyLeaveMinutes,
    workScheduleId: r.workScheduleId,
    isFinal: r.isFinal,
    needsReview: r.needsReview,
    hasCorrection: r.hasCorrection,
    hasManualEntry: Boolean(row.hasManualEntry),
    computedAt: r.computedAt.toISOString(),
    version: r.version,
  };
}

type EventRow = typeof schema.attendanceEvents.$inferSelect;

export function toEvent(e: EventRow, recordedByName: string | null): AttendanceEvent {
  return {
    id: e.id,
    type: e.type,
    source: e.source,
    workDate: e.workDate,
    occurredAt: e.occurredAt.toISOString(),
    recordedAt: e.recordedAt.toISOString(),
    checkInAt: isoOrNull(e.checkInAt),
    checkOutAt: isoOrNull(e.checkOutAt),
    correctionId: e.correctionId,
    reason: e.reason,
    ipAddress: e.ipAddress,
    userAgent: e.userAgent,
    recordedByName,
  };
}

// Day recomputation -------------------------------------------------------------------------------------------------

/**
 * Recomputes one employee's day from its events with the domain function, in the caller's transaction
 * (BUSINESS-RULES 2.4: every new event recomputes the row).
 */
export async function recomputeDay(
  tx: Tx,
  companyId: string,
  employeeId: string,
  workDate: string,
  now: Date,
) {
  const result = await computeDay(tx, companyId, employeeId, workDate);
  await repo.upsertRecord(tx, {
    companyId,
    employeeId,
    workDate,
    scheduleId: result.scheduleId,
    result: result.day,
    now,
  });
}

/** Loads the inputs of one day and evaluates it; exported for the SQL-mirror test (JOBS-AND-OUTBOX §5). */
export async function computeDay(db: Queryable, companyId: string, employeeId: string, workDate: string) {
  const ctx = await repo.loadDayContext(db, companyId, employeeId, workDate);
  if (!ctx) throw notFound();
  if (!ctx.schedule_id || !ctx.working_days || !ctx.core_start || !ctx.core_end)
    throw ruleViolation('No work schedule applies to this date.');
  const events = await repo.loadDayEvents(db, employeeId, workDate);
  const day = computeAttendanceDay({
    workDate,
    employment: {
      status: ctx.employee_status,
      joiningDate: ctx.joining_date,
      separationDate: ctx.separation_date,
    },
    schedule: {
      workingDays: ctx.working_days,
      coreStart: ctx.core_start,
      coreEnd: ctx.core_end,
      minDailyMinutes: ctx.min_daily_minutes ?? 0,
      breakMinutes: ctx.break_minutes ?? 0,
      timezone: ctx.timezone ?? 'Asia/Dhaka',
    },
    isHoliday: ctx.is_holiday,
    leave: ctx.leave,
    events,
  });
  return { scheduleId: ctx.schedule_id, day };
}

// Check-in and check-out (BUSINESS-RULES 2.1) ----------------------------------------------------------------------

const PUNCH_LIMIT = 10; // per minute per user (API-STANDARDS §10)
const IP_PATTERN = /^[0-9a-fA-F:.]{2,45}$/;

type LastPunch = Awaited<ReturnType<typeof repo.latestWebPunch>>;

/** The latest web punch is a check-in less than the checkout window ago (BUSINESS-RULES 2.1.2). */
function openCheckIn(last: LastPunch, now: Date, windowHours: number) {
  if (last?.type !== 'check_in') return null;
  return now.getTime() - last.occurredAt.getTime() < windowHours * 3_600_000 ? last : null;
}

async function punch(deps: Deps, auth: AuthContext, kind: 'check_in' | 'check_out'): Promise<PunchResult> {
  const employeeId = policy.punchEmployee(auth);
  const now = deps.clock.now();
  await rateLimit(deps.db, `attendance.punch:${auth.userId}`, PUNCH_LIMIT, 60, now);
  const windowHours = await getSetting(deps.db, auth.companyId, 'attendance.checkout_window_hours');
  const ip = deps.meta.ipAddress && IP_PATTERN.test(deps.meta.ipAddress) ? deps.meta.ipAddress : null;

  const event = await deps.db.transaction(async (tx) => {
    await repo.lockEmployeePunches(tx, employeeId);
    const open = openCheckIn(await repo.latestWebPunch(tx, employeeId), now, windowHours);
    if (kind === 'check_in' && open) throw new AppError('ALREADY_CHECKED_IN', 'Already checked in');
    if (kind === 'check_out' && !open) throw new AppError('NOT_CHECKED_IN', 'Not checked in');
    // A check-in starts the work date in Asia/Dhaka (D-011); a check-out belongs to its check-in's date, and one
    // after midnight is flagged for review by the status function.
    const workDate = open ? open.workDate : toBusinessDate(now);
    const row = await repo.insertEvent(tx, {
      id: uuidv7(now.getTime()),
      companyId: auth.companyId,
      employeeId,
      workDate,
      type: kind,
      occurredAt: now,
      recordedAt: now,
      source: 'web',
      ipAddress: ip,
      userAgent: deps.meta.userAgent,
      recordedBy: auth.userId,
    });
    await recomputeDay(tx, auth.companyId, employeeId, workDate, now);
    return row;
  });
  const record = await repo.findRecord(deps.db, auth.companyId, employeeId, event.workDate);
  if (!record) throw new Error('record missing after punch');
  return { event: toEvent(event, auth.user.name), record: toRecord(record) };
}

export const checkIn = (deps: Deps, auth: AuthContext) => punch(deps, auth, 'check_in');
export const checkOut = (deps: Deps, auth: AuthContext) => punch(deps, auth, 'check_out');

// Reads -------------------------------------------------------------------------------------------------------------

export async function myAttendance(
  deps: Deps,
  auth: AuthContext,
  q: MyAttendanceQuery,
): Promise<MyAttendanceResponse> {
  const employeeId = policy.ownEmployee(auth);
  const now = deps.clock.now();
  const today = toBusinessDate(now);
  const from = q.from ?? `${today.slice(0, 8)}01`;
  const to = q.to ?? today;
  if (to < from || to > addDays(from, 365))
    throw validationFailed([
      { path: 'query/to', code: 'custom', message: 'to must be on or after from, at most 366 days' },
    ]);
  const rows = await repo.listRecords(deps.db, {
    scope: auth.scopeOwn(),
    from,
    to,
    sort: q.sort,
    limit: q.pageSize,
    offset: pageOffset(q),
  });
  return {
    data: rows.map(toRecord),
    page: pageMeta(q, rows[0]?.total ?? 0),
    today: await todayState(deps, auth, employeeId, today, now),
  };
}

async function todayState(
  deps: Deps,
  auth: AuthContext,
  employeeId: string,
  today: string,
  now: Date,
): Promise<AttendanceToday> {
  const [last, windowHours, record, ctx] = await Promise.all([
    repo.latestWebPunch(deps.db, employeeId),
    getSetting(deps.db, auth.companyId, 'attendance.checkout_window_hours'),
    repo.findRecord(deps.db, auth.companyId, employeeId, today),
    repo.loadDayContext(deps.db, auth.companyId, employeeId, today),
  ]);
  const open = openCheckIn(last, now, windowHours);
  return {
    workDate: today,
    state: open ? 'checked_in' : last?.workDate === today ? 'checked_out' : 'not_checked_in',
    openCheckInAt: open ? open.occurredAt.toISOString() : null,
    record: record ? toRecord(record) : null,
    schedule:
      ctx?.schedule_id && ctx.working_days && ctx.core_start && ctx.core_end
        ? {
            id: ctx.schedule_id,
            name: ctx.schedule_name ?? '',
            coreStart: ctx.core_start.slice(0, 5),
            coreEnd: ctx.core_end.slice(0, 5),
            minDailyMinutes: ctx.min_daily_minutes ?? 0,
            breakMinutes: ctx.break_minutes ?? 0,
            isWorkingDay: ctx.working_days.includes(weekday(today)),
          }
        : null,
  };
}

export async function listRecords(deps: Deps, auth: AuthContext, q: AttendanceListQuery) {
  const scope = await policy.listScope(auth);
  const rows = await repo.listRecords(deps.db, {
    scope,
    from: q.from,
    to: q.to,
    employeeId: q.employeeId,
    departmentId: q.departmentId,
    statuses: q.status,
    needsReview: q.needsReview,
    sort: q.sort,
    limit: q.pageSize,
    offset: pageOffset(q),
  });
  return { data: rows.map(toRecord), page: pageMeta(q, rows[0]?.total ?? 0) };
}

export async function getDay(
  deps: Deps,
  auth: AuthContext,
  employeeId: string,
  workDate: string,
): Promise<AttendanceDayDetail> {
  if (!(await policy.canReadEmployee(auth, employeeId))) throw notFound();
  return dayDetail(deps.db, auth.companyId, employeeId, workDate);
}

export async function dayDetail(db: Queryable, companyId: string, employeeId: string, workDate: string) {
  const employee = await repo.findEmployeeRef(db, companyId, employeeId);
  if (!employee) throw notFound();
  const [record, events] = await Promise.all([
    repo.findRecord(db, companyId, employeeId, workDate),
    repo.listDayEvents(db, companyId, employeeId, workDate),
  ]);
  return {
    employee,
    workDate,
    record: record ? toRecord(record) : null,
    events: events.map((e) => toEvent(e.e, e.recordedByName)),
  };
}

export async function summary(deps: Deps, auth: AuthContext, q: AttendanceSummaryQuery) {
  const scope = await policy.summaryScope(auth);
  const rows = await repo.summary(deps.db, {
    scope,
    from: q.from,
    to: q.to,
    employeeId: q.employeeId,
    departmentId: q.departmentId,
    limit: q.pageSize,
    offset: pageOffset(q),
  });
  const data: AttendanceSummaryRow[] = rows.map((r) => ({
    employee: {
      id: r.employee_id,
      employeeCode: r.employee_code,
      name: r.employee_name,
      departmentName: r.department_name,
    },
    counts: r.counts,
    workedMinutes: r.worked_minutes,
    lateMinutes: r.late_minutes,
    earlyLeaveMinutes: r.early_leave_minutes,
    needsReview: r.needs_review,
  }));
  return { data, page: pageMeta(q, Number(rows[0]?.total ?? 0)) };
}

// Manual entries (FR-ATT-009) ---------------------------------------------------------------------------------------

export async function createManualEntry(deps: Deps, auth: AuthContext, input: CreateManualEntryInput) {
  policy.manage(auth);
  const now = deps.clock.now();
  const employee = await repo.findEmployeeRef(deps.db, auth.companyId, input.employeeId);
  if (!employee)
    throw validationFailed([{ path: '/employeeId', code: 'not_found', message: 'Employee not found.' }]);
  // Open question 8: HR recording their own attendance is refused until the owner decides.
  if (input.employeeId === auth.employeeId)
    throw new AppError('SELF_APPROVAL_FORBIDDEN', 'You cannot record your own attendance');
  if (input.workDate > toBusinessDate(now))
    throw new AppError('INVALID_DATE', 'Invalid date', 'Attendance cannot be recorded for a future date.');
  const checkInAt = new Date(input.checkInAt);
  const checkOutAt = new Date(input.checkOutAt);
  const windowHours = await getSetting(deps.db, auth.companyId, 'attendance.checkout_window_hours');
  const errors = [];
  if (toBusinessDate(checkInAt) !== input.workDate)
    errors.push({ path: '/checkInAt', code: 'custom', message: 'Check-in must fall on the work date.' });
  if (checkOutAt.getTime() - checkInAt.getTime() > windowHours * 3_600_000)
    errors.push({
      path: '/checkOutAt',
      code: 'custom',
      message: `Check-out must be within ${windowHours} hours of check-in.`,
    });
  if (checkInAt > now || checkOutAt > now)
    errors.push({ path: '/checkOutAt', code: 'custom', message: 'Times cannot be in the future.' });
  if (errors.length) throw validationFailed(errors);

  await deps.db.transaction(async (tx) => {
    await repo.lockEmployeePunches(tx, input.employeeId);
    const event = await repo.insertEvent(tx, {
      id: uuidv7(now.getTime()),
      companyId: auth.companyId,
      employeeId: input.employeeId,
      workDate: input.workDate,
      type: 'manual_entry',
      occurredAt: checkInAt,
      recordedAt: now,
      source: 'manual',
      checkInAt,
      checkOutAt,
      reason: input.reason,
      recordedBy: auth.userId,
    });
    await recomputeDay(tx, auth.companyId, input.employeeId, input.workDate, now);
    // The reason stays on the event; audit metadata carries no free text (AUDIT.md §4).
    await recordAudit(tx, auth.actor, {
      action: 'attendance.manual_entry_created',
      category: 'business',
      entityType: 'attendance_event',
      entityId: event.id,
      employeeId: input.employeeId,
      metadata: { workDate: input.workDate, checkInAt: input.checkInAt, checkOutAt: input.checkOutAt },
    });
  });
  return dayDetail(deps.db, auth.companyId, input.employeeId, input.workDate);
}
