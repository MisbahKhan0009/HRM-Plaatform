import type { AttendanceStatus } from '@hrm/contracts';
import { type Queryable, type RequestScope, schema, type Tx, uuidv7 } from '@hrm/db';
import type { DayEvent, DayLeave, DayResult } from '@hrm/domain';
import { and, asc, desc, eq, gte, inArray, lte, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

const { attendanceEvents, attendanceRecords, attendanceCorrections, employees, users } = schema;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A `uuid[]` parameter sent as an array literal (the client runs without type discovery, `fetch_types: false`). */
export function uuidArray(ids: readonly string[]) {
  for (const id of ids) if (!UUID.test(id)) throw new Error('invalid uuid in array parameter');
  return sql`${`{${ids.join(',')}}`}::uuid[]`;
}

/**
 * Restricts an employee-id column to the scope. `whereEmployeeInScope` from `@hrm/db` sends the id list as an array
 * parameter, which this client serialises as a plain string; the array literal form works.
 */
export function inScope(column: AnyPgColumn, scope: RequestScope): SQL | undefined {
  if (scope.employees === 'all') return undefined;
  if (scope.employees.length === 0) return sql`false`;
  return sql`${column} = ANY(${uuidArray(scope.employees)})`;
}

export const employeeName = sql<string>`coalesce(${employees.preferredName}, ${employees.firstName}) || ' ' || ${employees.lastName}`;

// Day inputs ---------------------------------------------------------------------------------------------------------

export type DayContextRow = {
  employee_status: string;
  joining_date: string | null;
  separation_date: string | null;
  schedule_id: string | null;
  schedule_name: string | null;
  working_days: number[] | null;
  core_start: string | null;
  core_end: string | null;
  min_daily_minutes: number | null;
  break_minutes: number | null;
  timezone: string | null;
  is_holiday: boolean;
  leave: DayLeave;
};

/**
 * Everything the status function needs besides events, in one query (BUSINESS-RULES 2.3): employment, the schedule
 * for the date (the employee's assignment, else the company default), holiday, and approved leave covering the date.
 */
export async function loadDayContext(db: Queryable, companyId: string, employeeId: string, workDate: string) {
  const rows = await db.execute<DayContextRow>(sql`
    SELECT e.status AS employee_status, e.joining_date::text AS joining_date, e.separation_date::text AS separation_date,
      ws.id AS schedule_id, ws.name AS schedule_name, to_json(ws.working_days) AS working_days,
      ws.core_start::text AS core_start, ws.core_end::text AS core_end, ws.min_daily_minutes, ws.break_minutes,
      ws.timezone,
      EXISTS (SELECT 1 FROM holidays h WHERE h.company_id = e.company_id AND h.date = ${workDate}::date) AS is_holiday,
      coalesce((
        SELECT CASE WHEN bool_or(lr.unit = 'day') OR count(DISTINCT lr.half_day_part) >= 2 THEN 'full' ELSE 'half' END
        FROM leave_requests lr
        WHERE lr.employee_id = e.id AND lr.status IN ('approved', 'cancellation_pending')
          AND ${workDate}::date BETWEEN lr.start_date AND lr.end_date
        HAVING count(*) > 0
      ), 'none') AS leave
    FROM employees e
    LEFT JOIN LATERAL (
      SELECT w.* FROM work_schedules w
      WHERE w.id = coalesce(
        (SELECT sa.work_schedule_id FROM schedule_assignments sa
         WHERE sa.employee_id = e.id AND sa.effective_from <= ${workDate}::date
           AND (sa.effective_to IS NULL OR sa.effective_to >= ${workDate}::date)
         ORDER BY sa.effective_from DESC LIMIT 1),
        (SELECT d.id FROM work_schedules d WHERE d.company_id = e.company_id AND d.is_default LIMIT 1))
    ) ws ON true
    WHERE e.id = ${employeeId} AND e.company_id = ${companyId}`);
  return rows[0] ?? null;
}

export async function loadDayEvents(
  db: Queryable,
  employeeId: string,
  workDate: string,
): Promise<DayEvent[]> {
  return db
    .select({
      id: attendanceEvents.id,
      type: attendanceEvents.type,
      occurredAt: attendanceEvents.occurredAt,
      recordedAt: attendanceEvents.recordedAt,
      checkInAt: attendanceEvents.checkInAt,
      checkOutAt: attendanceEvents.checkOutAt,
    })
    .from(attendanceEvents)
    .where(and(eq(attendanceEvents.employeeId, employeeId), eq(attendanceEvents.workDate, workDate)))
    .orderBy(asc(attendanceEvents.recordedAt), asc(attendanceEvents.id));
}

/** Writes the derived day; a new row starts provisional, an update keeps `is_final` (BUSINESS-RULES 2.4). */
export async function upsertRecord(
  tx: Tx,
  input: {
    companyId: string;
    employeeId: string;
    workDate: string;
    scheduleId: string | null;
    result: DayResult;
    now: Date;
  },
) {
  const values = {
    workScheduleId: input.scheduleId,
    firstInAt: input.result.firstInAt,
    lastOutAt: input.result.lastOutAt,
    workedMinutes: input.result.workedMinutes,
    lateMinutes: input.result.lateMinutes,
    earlyLeaveMinutes: input.result.earlyLeaveMinutes,
    status: input.result.status,
    needsReview: input.result.needsReview,
    hasCorrection: input.result.hasCorrection,
    computedAt: input.now,
  };
  const [row] = await tx
    .insert(attendanceRecords)
    .values({
      id: uuidv7(),
      companyId: input.companyId,
      employeeId: input.employeeId,
      workDate: input.workDate,
      isFinal: false,
      ...values,
    })
    .onConflictDoUpdate({
      target: [attendanceRecords.employeeId, attendanceRecords.workDate],
      set: { ...values, version: sql`${attendanceRecords.version} + 1` },
    })
    .returning({ id: attendanceRecords.id });
  return row?.id as string;
}

// Punches -----------------------------------------------------------------------------------------------------------

/** Serialises punches of one employee so two tabs cannot both check in (BUSINESS-RULES 2.1). */
export async function lockEmployeePunches(tx: Tx, employeeId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`attendance:${employeeId}`}))`);
}

/** The employee's latest web punch, if it is a check-in: the candidate open check-in (BUSINESS-RULES 2.1.2). */
export async function latestWebPunch(db: Queryable, employeeId: string) {
  const [row] = await db
    .select({
      id: attendanceEvents.id,
      type: attendanceEvents.type,
      occurredAt: attendanceEvents.occurredAt,
      workDate: attendanceEvents.workDate,
    })
    .from(attendanceEvents)
    .where(
      and(
        eq(attendanceEvents.employeeId, employeeId),
        inArray(attendanceEvents.type, ['check_in', 'check_out']),
      ),
    )
    .orderBy(desc(attendanceEvents.occurredAt), desc(attendanceEvents.id))
    .limit(1);
  return row ?? null;
}

export async function insertEvent(tx: Tx, values: typeof attendanceEvents.$inferInsert) {
  const [row] = await tx.insert(attendanceEvents).values(values).returning();
  if (!row) throw new Error('insert returned nothing');
  return row;
}

// Reads -------------------------------------------------------------------------------------------------------------

const recordSelection = {
  r: attendanceRecords,
  employeeCode: employees.employeeCode,
  employeeName,
  hasManualEntry: sql<boolean>`EXISTS (SELECT 1 FROM attendance_events me WHERE me.employee_id = ${attendanceRecords.employeeId}
    AND me.work_date = ${attendanceRecords.workDate} AND me.type = 'manual_entry')`,
  total: sql<number>`count(*) OVER ()`.mapWith(Number),
};

export type RecordRow = Awaited<ReturnType<typeof listRecords>>[number];

export function listRecords(
  db: Queryable,
  input: {
    scope: RequestScope;
    from: string;
    to: string;
    employeeId?: string | undefined;
    departmentId?: string | undefined;
    statuses?: readonly AttendanceStatus[] | undefined;
    needsReview?: boolean | undefined;
    sort: 'workDate' | '-workDate';
    limit: number;
    offset: number;
  },
) {
  return db
    .select(recordSelection)
    .from(attendanceRecords)
    .innerJoin(employees, eq(employees.id, attendanceRecords.employeeId))
    .where(
      and(
        eq(attendanceRecords.companyId, input.scope.companyId),
        inScope(attendanceRecords.employeeId, input.scope),
        gte(attendanceRecords.workDate, input.from),
        lte(attendanceRecords.workDate, input.to),
        input.employeeId ? eq(attendanceRecords.employeeId, input.employeeId) : undefined,
        input.departmentId ? eq(employees.departmentId, input.departmentId) : undefined,
        input.statuses?.length ? inArray(attendanceRecords.status, [...input.statuses]) : undefined,
        input.needsReview === undefined ? undefined : eq(attendanceRecords.needsReview, input.needsReview),
      ),
    )
    .orderBy(
      input.sort === 'workDate' ? asc(attendanceRecords.workDate) : desc(attendanceRecords.workDate),
      asc(employees.employeeCode),
      asc(attendanceRecords.id),
    )
    .limit(input.limit)
    .offset(input.offset);
}

export async function findRecord(db: Queryable, companyId: string, employeeId: string, workDate: string) {
  const [row] = await db
    .select(recordSelection)
    .from(attendanceRecords)
    .innerJoin(employees, eq(employees.id, attendanceRecords.employeeId))
    .where(
      and(
        eq(attendanceRecords.companyId, companyId),
        eq(attendanceRecords.employeeId, employeeId),
        eq(attendanceRecords.workDate, workDate),
      ),
    );
  return row ?? null;
}

export async function findEmployeeRef(db: Queryable, companyId: string, employeeId: string) {
  const [row] = await db
    .select({ id: employees.id, employeeCode: employees.employeeCode, name: employeeName })
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.id, employeeId)));
  return row ?? null;
}

export function listDayEvents(db: Queryable, companyId: string, employeeId: string, workDate: string) {
  return db
    .select({ e: attendanceEvents, recordedByName: users.name })
    .from(attendanceEvents)
    .leftJoin(users, eq(users.id, attendanceEvents.recordedBy))
    .where(
      and(
        eq(attendanceEvents.companyId, companyId),
        eq(attendanceEvents.employeeId, employeeId),
        eq(attendanceEvents.workDate, workDate),
      ),
    )
    .orderBy(asc(attendanceEvents.recordedAt), asc(attendanceEvents.id))
    .limit(200);
}

export type SummaryRow = {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  counts: Record<AttendanceStatus, number>;
  worked_minutes: number;
  late_minutes: number;
  early_leave_minutes: number;
  needs_review: number;
  total: string;
};

/** Per-employee counts per status over a range, aggregated in SQL (FR-ATT-011, ADR-0009). */
export function summary(
  db: Queryable,
  input: {
    scope: RequestScope;
    from: string;
    to: string;
    employeeId?: string | undefined;
    departmentId?: string | undefined;
    limit: number;
    offset: number;
  },
) {
  const scopeSql =
    input.scope.employees === 'all' ? sql`` : sql` AND e.id = ANY(${uuidArray(input.scope.employees)})`;
  return db.execute<SummaryRow>(sql`
    SELECT e.id AS employee_id, e.employee_code,
      coalesce(e.preferred_name, e.first_name) || ' ' || e.last_name AS employee_name, d.name AS department_name,
      json_build_object(
        'present', count(*) FILTER (WHERE r.status = 'present'),
        'short_hours', count(*) FILTER (WHERE r.status = 'short_hours'),
        'missed_core', count(*) FILTER (WHERE r.status = 'missed_core'),
        'missing_punch', count(*) FILTER (WHERE r.status = 'missing_punch'),
        'absent', count(*) FILTER (WHERE r.status = 'absent'),
        'on_leave', count(*) FILTER (WHERE r.status = 'on_leave'),
        'holiday', count(*) FILTER (WHERE r.status = 'holiday'),
        'weekend', count(*) FILTER (WHERE r.status = 'weekend'),
        'not_employed', count(*) FILTER (WHERE r.status = 'not_employed')
      ) AS counts,
      coalesce(sum(r.worked_minutes), 0)::int AS worked_minutes,
      coalesce(sum(r.late_minutes), 0)::int AS late_minutes,
      coalesce(sum(r.early_leave_minutes), 0)::int AS early_leave_minutes,
      (count(*) FILTER (WHERE r.needs_review))::int AS needs_review,
      count(*) OVER () AS total
    FROM attendance_records r
    JOIN employees e ON e.id = r.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    WHERE r.company_id = ${input.scope.companyId} AND r.work_date BETWEEN ${input.from}::date AND ${input.to}::date
      ${scopeSql}
      ${input.employeeId ? sql` AND e.id = ${input.employeeId}` : sql``}
      ${input.departmentId ? sql` AND e.department_id = ${input.departmentId}` : sql``}
    GROUP BY e.id, d.name
    ORDER BY e.employee_code, e.id
    LIMIT ${input.limit} OFFSET ${input.offset}`);
}

// Corrections -------------------------------------------------------------------------------------------------------

const correctionSelection = { c: attendanceCorrections, employeeCode: employees.employeeCode, employeeName };

export type CorrectionRow = NonNullable<Awaited<ReturnType<typeof findCorrection>>>;

export async function findCorrection(db: Queryable, scope: RequestScope, id: string, forUpdate = false) {
  const q = db
    .select(correctionSelection)
    .from(attendanceCorrections)
    .innerJoin(employees, eq(employees.id, attendanceCorrections.employeeId))
    .where(
      and(
        eq(attendanceCorrections.companyId, scope.companyId),
        eq(attendanceCorrections.id, id),
        inScope(attendanceCorrections.employeeId, scope),
      ),
    );
  const [row] = forUpdate ? await q.for('update', { of: attendanceCorrections }) : await q;
  return row ?? null;
}

export function listCorrections(
  db: Queryable,
  input: {
    companyId: string;
    /** Visible employees: the review scope plus the caller's own employee. */
    visible: SQL | undefined;
    statuses?: readonly string[] | undefined;
    employeeId?: string | undefined;
    limit: number;
    offset: number;
  },
) {
  return db
    .select({ ...correctionSelection, total: sql<number>`count(*) OVER ()`.mapWith(Number) })
    .from(attendanceCorrections)
    .innerJoin(employees, eq(employees.id, attendanceCorrections.employeeId))
    .where(
      and(
        eq(attendanceCorrections.companyId, input.companyId),
        input.visible,
        input.employeeId ? eq(attendanceCorrections.employeeId, input.employeeId) : undefined,
        input.statuses?.length ? inArray(attendanceCorrections.status, [...input.statuses]) : undefined,
      ),
    )
    .orderBy(desc(attendanceCorrections.createdAt), desc(attendanceCorrections.id))
    .limit(input.limit)
    .offset(input.offset);
}

export async function insertCorrection(tx: Tx, values: typeof attendanceCorrections.$inferInsert) {
  await tx.insert(attendanceCorrections).values(values);
}

export async function updateCorrectionStatus(
  tx: Tx,
  input: {
    companyId: string;
    id: string;
    version: number;
    status: 'approved' | 'rejected' | 'withdrawn';
    userId: string;
    now: Date;
    comment: string | null;
    decided: boolean;
  },
) {
  const [row] = await tx
    .update(attendanceCorrections)
    .set({
      status: input.status,
      updatedAt: input.now,
      updatedBy: input.userId,
      version: sql`${attendanceCorrections.version} + 1`,
      ...(input.decided
        ? { decidedAt: input.now, decidedBy: input.userId, decisionComment: input.comment }
        : {}),
    })
    .where(
      and(
        eq(attendanceCorrections.companyId, input.companyId),
        eq(attendanceCorrections.id, input.id),
        eq(attendanceCorrections.version, input.version),
        eq(attendanceCorrections.status, 'pending'),
      ),
    )
    .returning({ id: attendanceCorrections.id });
  return row?.id ?? null;
}

// Daily close (JOBS-AND-OUTBOX §5) ------------------------------------------------------------------------------------

/**
 * The day's derived rows for a company, set-based. Mirrors `computeAttendanceDay` in `@hrm/domain` rule for rule
 * (BUSINESS-RULES 2.2 and 2.3); a test asserts both agree on fixtures. Employees are those employed on the date, plus
 * anyone with events or a record for it.
 */
function computedDaySql(companyId: string, workDate: string) {
  return sql`
    WITH p AS (SELECT ${companyId}::uuid AS company_id, ${workDate}::date AS d),
    emp AS (
      SELECT e.id, e.status, e.joining_date, e.separation_date,
        (e.status NOT IN ('draft', 'preboarding') AND e.joining_date IS NOT NULL AND e.joining_date <= p.d
          AND (e.separation_date IS NULL OR e.separation_date >= p.d)) AS employed
      FROM employees e CROSS JOIN p
      WHERE e.company_id = p.company_id AND (
        (e.status NOT IN ('draft', 'preboarding') AND e.joining_date IS NOT NULL AND e.joining_date <= p.d
          AND (e.separation_date IS NULL OR e.separation_date >= p.d))
        OR EXISTS (SELECT 1 FROM attendance_events x WHERE x.employee_id = e.id AND x.work_date = p.d)
        OR EXISTS (SELECT 1 FROM attendance_records x WHERE x.employee_id = e.id AND x.work_date = p.d))
    ),
    sched AS (
      SELECT emp.id AS employee_id, w.id AS schedule_id, w.working_days, w.core_start, w.core_end,
        w.min_daily_minutes, w.break_minutes, w.timezone
      FROM emp CROSS JOIN p
      JOIN LATERAL (
        SELECT ws.* FROM work_schedules ws
        WHERE ws.id = coalesce(
          (SELECT sa.work_schedule_id FROM schedule_assignments sa
           WHERE sa.employee_id = emp.id AND sa.effective_from <= p.d
             AND (sa.effective_to IS NULL OR sa.effective_to >= p.d)
           ORDER BY sa.effective_from DESC LIMIT 1),
          (SELECT ws2.id FROM work_schedules ws2 WHERE ws2.company_id = p.company_id AND ws2.is_default LIMIT 1))
      ) w ON true
    ),
    ev AS (
      SELECT x.* FROM attendance_events x CROSS JOIN p
      WHERE x.company_id = p.company_id AND x.work_date = p.d
    ),
    web AS (
      SELECT ev.employee_id, ev.id, ev.type, ev.occurred_at,
        lead(ev.type) OVER w AS next_type, lead(ev.occurred_at) OVER w AS next_at
      FROM ev WHERE ev.type IN ('check_in', 'check_out')
      WINDOW w AS (PARTITION BY ev.employee_id ORDER BY ev.occurred_at, ev.id)
    ),
    pairs AS (
      SELECT employee_id, id, occurred_at AS in_at,
        CASE WHEN next_type = 'check_out' THEN next_at END AS out_at
      FROM web WHERE type = 'check_in'
    ),
    web_sum AS (
      SELECT employee_id, min(in_at) AS first_in, (array_agg(out_at ORDER BY in_at DESC, id DESC))[1] AS last_pair_out
      FROM pairs GROUP BY employee_id
    ),
    ov AS (
      SELECT DISTINCT ON (employee_id) employee_id, check_in_at, check_out_at
      FROM ev WHERE type IN ('manual_entry', 'correction')
      ORDER BY employee_id, recorded_at DESC, id DESC
    ),
    eff_raw AS (
      SELECT pairs.employee_id, pairs.in_at, pairs.out_at FROM pairs
      WHERE NOT EXISTS (SELECT 1 FROM ov WHERE ov.employee_id = pairs.employee_id)
      UNION ALL
      SELECT ov.employee_id, coalesce(ov.check_in_at, ws.first_in), coalesce(ov.check_out_at, ws.last_pair_out)
      FROM ov LEFT JOIN web_sum ws ON ws.employee_id = ov.employee_id
    ),
    eff AS (
      SELECT employee_id, in_at,
        CASE WHEN in_at IS NULL THEN out_at WHEN out_at > in_at THEN out_at END AS out_at
      FROM eff_raw
    ),
    agg AS (
      SELECT employee_id, min(in_at) AS first_in, max(out_at) AS last_out,
        coalesce(sum(floor(extract(epoch FROM out_at - in_at) / 60)) FILTER (WHERE in_at IS NOT NULL AND out_at IS NOT NULL), 0)::int AS span,
        bool_or(in_at IS NULL OR out_at IS NULL) AS incomplete
      FROM eff GROUP BY employee_id
    ),
    facts AS (
      SELECT ev.employee_id, count(*)::int AS n, bool_or(ev.type = 'correction') AS has_correction,
        bool_or(ev.type = 'check_out' AND (ev.occurred_at AT TIME ZONE s.timezone)::date > p.d) AS needs_review
      FROM ev JOIN sched s ON s.employee_id = ev.employee_id CROSS JOIN p
      GROUP BY ev.employee_id
    ),
    lv AS (
      SELECT lr.employee_id,
        CASE WHEN bool_or(lr.unit = 'day') OR count(DISTINCT lr.half_day_part) >= 2 THEN 'full' ELSE 'half' END AS leave
      FROM leave_requests lr CROSS JOIN p
      WHERE lr.company_id = p.company_id AND lr.status IN ('approved', 'cancellation_pending')
        AND p.d BETWEEN lr.start_date AND lr.end_date
      GROUP BY lr.employee_id
    ),
    base AS (
      SELECT emp.id AS employee_id, s.schedule_id, s.min_daily_minutes, a.first_in, a.last_out,
        CASE WHEN coalesce(a.span, 0) > s.break_minutes THEN a.span - s.break_minutes ELSE 0 END AS worked,
        (p.d + s.core_start) AT TIME ZONE s.timezone AS core_start_at,
        (p.d + s.core_end) AT TIME ZONE s.timezone AS core_end_at,
        coalesce(lv.leave, 'none') AS leave, coalesce(f.n, 0) AS n,
        coalesce(f.has_correction, false) AS has_correction, coalesce(f.needs_review, false) AS needs_review,
        coalesce(a.incomplete, false) AS incomplete,
        CASE
          WHEN NOT emp.employed THEN 'off'
          WHEN NOT (extract(dow FROM p.d)::smallint = ANY(s.working_days)) THEN 'off'
          WHEN EXISTS (SELECT 1 FROM holidays h WHERE h.company_id = p.company_id AND h.date = p.d) THEN 'off'
          WHEN coalesce(lv.leave, 'none') = 'full' THEN 'off'
          ELSE 'work'
        END AS kind,
        CASE
          WHEN NOT emp.employed THEN 'not_employed'
          WHEN NOT (extract(dow FROM p.d)::smallint = ANY(s.working_days)) THEN 'weekend'
          WHEN EXISTS (SELECT 1 FROM holidays h WHERE h.company_id = p.company_id AND h.date = p.d) THEN 'holiday'
          WHEN coalesce(lv.leave, 'none') = 'full' THEN 'on_leave'
        END AS off_status
      FROM emp CROSS JOIN p
      JOIN sched s ON s.employee_id = emp.id
      LEFT JOIN agg a ON a.employee_id = emp.id
      LEFT JOIN facts f ON f.employee_id = emp.id
      LEFT JOIN lv ON lv.employee_id = emp.id
    )
    SELECT employee_id, schedule_id, first_in, last_out, worked, needs_review, has_correction,
      (CASE
        WHEN kind = 'off' THEN off_status
        WHEN n = 0 THEN 'absent'
        WHEN incomplete OR first_in IS NULL THEN 'missing_punch'
        WHEN worked * (CASE WHEN leave = 'half' THEN 2 ELSE 1 END) < min_daily_minutes THEN 'short_hours'
        WHEN leave <> 'half' AND last_out IS NOT NULL AND (first_in > core_start_at OR last_out < core_end_at)
          THEN 'missed_core'
        ELSE 'present'
      END)::attendance_status AS status,
      CASE WHEN kind = 'off' OR leave = 'half' OR first_in IS NULL THEN 0
        ELSE greatest(0, floor(extract(epoch FROM first_in - core_start_at) / 60))::int END AS late,
      CASE WHEN kind = 'off' OR leave = 'half' OR last_out IS NULL THEN 0
        ELSE greatest(0, floor(extract(epoch FROM core_end_at - last_out) / 60))::int END AS early,
      row_number() OVER (ORDER BY employee_id) AS ord
    FROM base`;
}

/**
 * `attendance.close_day` (BUSINESS-RULES 2.4): one INSERT … ON CONFLICT DO UPDATE creates missing rows, recomputes
 * existing ones and marks them final. Ids are generated by the application (DATA-MODEL conventions), one per
 * employee of the company, and matched by position. Re-running gives the same rows.
 */
export async function closeDay(tx: Tx, companyId: string, workDate: string, now: Date): Promise<number> {
  const [count] = await tx.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM employees WHERE company_id = ${companyId}`,
  );
  const ids = Array.from({ length: count?.n ?? 0 }, () => uuidv7(now.getTime()));
  if (!ids.length) return 0;
  const rows = await tx.execute<{ id: string }>(sql`
    WITH calc AS (${computedDaySql(companyId, workDate)}),
    ids AS (SELECT id, ord FROM unnest(${uuidArray(ids)}) WITH ORDINALITY AS t(id, ord))
    INSERT INTO attendance_records (id, company_id, employee_id, work_date, work_schedule_id, first_in_at, last_out_at,
      worked_minutes, late_minutes, early_leave_minutes, status, is_final, needs_review, has_correction, computed_at)
    SELECT ids.id, ${companyId}, calc.employee_id, ${workDate}::date, calc.schedule_id, calc.first_in, calc.last_out,
      calc.worked, calc.late, calc.early, calc.status, true, calc.needs_review, calc.has_correction, ${now.toISOString()}::timestamptz
    FROM calc JOIN ids ON ids.ord = calc.ord
    ON CONFLICT (employee_id, work_date) DO UPDATE SET
      work_schedule_id = EXCLUDED.work_schedule_id, first_in_at = EXCLUDED.first_in_at,
      last_out_at = EXCLUDED.last_out_at, worked_minutes = EXCLUDED.worked_minutes,
      late_minutes = EXCLUDED.late_minutes, early_leave_minutes = EXCLUDED.early_leave_minutes,
      status = EXCLUDED.status, is_final = true, needs_review = EXCLUDED.needs_review,
      has_correction = EXCLUDED.has_correction, computed_at = EXCLUDED.computed_at,
      version = attendance_records.version + 1
    RETURNING id`);
  return rows.length;
}
