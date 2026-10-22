import { schema, uuidv7 } from '@hrm/db';
import { zonedInstant } from '@hrm/domain';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { runJob } from '../../src/jobs/run-job';
import { fixedClock } from '../../src/lib/clock';
import type { Deps } from '../../src/lib/deps';
import { closeDayStep } from '../../src/modules/attendance/attendance.jobs';
import { closeDay } from '../../src/modules/attendance/attendance.repository';
import { computeDay } from '../../src/modules/attendance/attendance.service';
import { type Fixture, setupCompany } from '../harness';

// JOBS-AND-OUTBOX §5: the set-based close and the TypeScript status function must agree on the same fixtures.

const WED = '2026-11-04';
const FRI = '2026-11-06';
const HOLIDAY = '2026-11-03';
const local = (date: string, time: string) => zonedInstant(date, time);

let f: Fixture;
let breakSchedule: string;
const ids: Record<string, string> = {};

async function punch(
  employeeId: string,
  workDate: string,
  type: (typeof schema.attendanceEvents.$inferInsert)['type'],
  at: Date,
  extra: Partial<typeof schema.attendanceEvents.$inferInsert> = {},
) {
  await f.db.insert(schema.attendanceEvents).values({
    id: uuidv7(),
    companyId: f.companyId,
    employeeId,
    workDate,
    type,
    occurredAt: at,
    recordedAt: extra.recordedAt ?? at,
    source: 'web',
    ...extra,
  });
}

async function pair(employeeId: string, date: string, from: string, to: string | null, outDate = date) {
  await punch(employeeId, date, 'check_in', local(date, from));
  if (to) await punch(employeeId, date, 'check_out', local(outDate, to));
}

async function override(
  employeeId: string,
  date: string,
  type: 'manual_entry' | 'correction',
  checkIn: Date | null,
  checkOut: Date | null,
  recordedAt: Date,
) {
  let correctionId: string | null = null;
  if (type === 'correction') {
    correctionId = uuidv7();
    await f.db.insert(schema.attendanceCorrections).values({
      id: correctionId,
      companyId: f.companyId,
      employeeId,
      workDate: date,
      status: 'approved',
      proposedCheckInAt: checkIn,
      proposedCheckOutAt: checkOut,
      reason: 'Forgot to punch',
    });
  }
  await punch(employeeId, date, type, (checkIn ?? checkOut) as Date, {
    source: type === 'correction' ? 'correction' : 'manual',
    checkInAt: checkIn,
    checkOutAt: checkOut,
    correctionId,
    reason: 'Fixture override',
    recordedAt,
  });
}

async function leave(employeeId: string, date: string, unit: 'day' | 'half_day', status = 'approved') {
  const [policy] = await f.db
    .select({ id: schema.leavePolicies.id, typeId: schema.leavePolicies.leaveTypeId })
    .from(schema.leavePolicies)
    .where(eq(schema.leavePolicies.companyId, f.companyId))
    .limit(1);
  if (!policy) throw new Error('no leave policy seeded');
  await f.db.insert(schema.leaveRequests).values({
    id: uuidv7(),
    companyId: f.companyId,
    requestNumber: `LV-${Math.random().toString().slice(2, 8)}`,
    employeeId,
    leaveTypeId: policy.typeId,
    leavePolicyId: policy.id,
    startDate: date,
    endDate: date,
    unit,
    halfDayPart: unit === 'half_day' ? 'first_half' : null,
    requestedUnits: unit === 'half_day' ? '0.50' : '1.00',
    status,
  });
}

beforeAll(async () => {
  f = await setupCompany('Close Day Co');
  breakSchedule = uuidv7();
  await f.db.insert(schema.workSchedules).values({
    id: breakSchedule,
    companyId: f.companyId,
    name: 'With lunch',
    workingDays: [0, 1, 2, 3, 4],
    coreStart: '10:00',
    coreEnd: '16:00',
    minDailyMinutes: 480,
    breakMinutes: 60,
  });
  await f.db
    .insert(schema.holidays)
    .values({ id: uuidv7(), companyId: f.companyId, date: HOLIDAY, name: 'Fixture holiday' });

  const make = async (name: string, o: Parameters<Fixture['employee']>[0] = {}) => {
    ids[name] = await f.employee({ firstName: name, ...o });
    return ids[name] as string;
  };

  await pair(await make('present'), WED, '09:05', '18:10');
  await pair(await make('missing'), WED, '09:30', null);
  const multi = await make('multi');
  await pair(multi, WED, '07:00', '15:00');
  await pair(multi, WED, '15:30', '17:00');
  await make('absent');
  await make('future_joiner', { joiningDate: '2026-12-01' });
  await pair(await make('joiner_with_punch', { joiningDate: '2026-11-05' }), WED, '09:00', '18:00');
  await make('draft', { status: 'draft' });
  await make('separated', { joiningDate: '2025-01-01' });
  await f.db
    .update(schema.employees)
    .set({ status: 'separated', separationDate: '2026-10-31' })
    .where(eq(schema.employees.id, ids.separated as string));
  const onLeave = await make('on_leave');
  await leave(onLeave, WED, 'day');
  const halfDay = await make('half_day');
  await leave(halfDay, WED, 'half_day');
  await pair(halfDay, WED, '13:00', '17:05');
  const rejectedLeave = await make('rejected_leave');
  await leave(rejectedLeave, WED, 'day', 'rejected');
  const corrected = await make('corrected');
  await pair(corrected, WED, '09:30', null);
  await override(corrected, WED, 'correction', null, local(WED, '18:30'), local('2026-11-05', '09:00'));
  const manual = await make('manual');
  await pair(manual, WED, '11:00', '12:00');
  await override(
    manual,
    WED,
    'manual_entry',
    local(WED, '08:00'),
    local(WED, '17:00'),
    local('2026-11-05', '08:00'),
  );
  await override(manual, WED, 'manual_entry', local(WED, '09:00'), null, local('2026-11-05', '10:00'));
  await pair(await make('night'), WED, '20:00', '00:30', '2026-11-05');
  const late = await make('late_with_break');
  await f.db.insert(schema.scheduleAssignments).values({
    id: uuidv7(),
    companyId: f.companyId,
    employeeId: late,
    workScheduleId: breakSchedule,
    effectiveFrom: '2026-11-01',
  });
  await pair(late, WED, '10:40', '19:00');
  await pair(await make('missed_core'), WED, '06:00', '15:00');
  const weekendWorker = await make('weekend_worker');
  await pair(weekendWorker, FRI, '10:00', '14:00');
  await pair(await make('holiday_worker'), HOLIDAY, '10:00', '12:00');
}, 120_000);

const pick = (r: typeof schema.attendanceRecords.$inferSelect) => ({
  status: r.status,
  firstInAt: r.firstInAt?.toISOString() ?? null,
  lastOutAt: r.lastOutAt?.toISOString() ?? null,
  workedMinutes: r.workedMinutes,
  lateMinutes: r.lateMinutes,
  earlyLeaveMinutes: r.earlyLeaveMinutes,
  needsReview: r.needsReview,
  hasCorrection: r.hasCorrection,
  workScheduleId: r.workScheduleId,
});

async function records(date: string) {
  return f.db
    .select()
    .from(schema.attendanceRecords)
    .where(
      and(eq(schema.attendanceRecords.companyId, f.companyId), eq(schema.attendanceRecords.workDate, date)),
    );
}

async function expectSqlMatchesTs(date: string) {
  const rows = await records(date);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    const ts = await computeDay(f.db, f.companyId, row.employeeId, date);
    expect(pick(row), `employee ${row.employeeId}`).toEqual({
      status: ts.day.status,
      firstInAt: ts.day.firstInAt?.toISOString() ?? null,
      lastOutAt: ts.day.lastOutAt?.toISOString() ?? null,
      workedMinutes: ts.day.workedMinutes,
      lateMinutes: ts.day.lateMinutes,
      earlyLeaveMinutes: ts.day.earlyLeaveMinutes,
      needsReview: ts.day.needsReview,
      hasCorrection: ts.day.hasCorrection,
      workScheduleId: ts.scheduleId,
    });
    expect(row.isFinal).toBe(true);
  }
  return rows;
}

const now = new Date('2026-11-06T18:10:00Z');

describe('attendance.close_day', () => {
  it('agrees with the TypeScript status function on every fixture', async () => {
    await f.db.transaction((tx) => closeDay(tx, f.companyId, WED, now));
    const rows = await expectSqlMatchesTs(WED);
    const status = Object.fromEntries(
      Object.entries(ids).map(([name, id]) => [name, rows.find((r) => r.employeeId === id)?.status ?? null]),
    );
    expect(status).toMatchObject({
      present: 'present',
      missing: 'missing_punch',
      multi: 'present',
      absent: 'absent',
      future_joiner: null,
      joiner_with_punch: 'not_employed',
      draft: null,
      separated: null,
      on_leave: 'on_leave',
      half_day: 'present',
      rejected_leave: 'absent',
      corrected: 'present',
      manual: 'short_hours',
      night: 'short_hours',
      late_with_break: 'short_hours',
      missed_core: 'missed_core',
    });
    const night = rows.find((r) => r.employeeId === ids.night);
    expect(night?.needsReview).toBe(true);
    const late = rows.find((r) => r.employeeId === ids.late_with_break);
    expect(late).toMatchObject({ workedMinutes: 440, lateMinutes: 40, workScheduleId: breakSchedule });
  });

  it('records weekend and holiday work without changing the status', async () => {
    await f.db.transaction((tx) => closeDay(tx, f.companyId, FRI, now));
    const fri = await expectSqlMatchesTs(FRI);
    expect(fri.find((r) => r.employeeId === ids.weekend_worker)).toMatchObject({
      status: 'weekend',
      workedMinutes: 240,
    });
    await f.db.transaction((tx) => closeDay(tx, f.companyId, HOLIDAY, now));
    const hol = await expectSqlMatchesTs(HOLIDAY);
    expect(hol.find((r) => r.employeeId === ids.holiday_worker)).toMatchObject({
      status: 'holiday',
      workedMinutes: 120,
    });
  });

  it('gives the same rows when run twice', async () => {
    const before = await records(WED);
    await f.db.transaction((tx) => closeDay(tx, f.companyId, WED, now));
    const after = await records(WED);
    expect(after.map((r) => ({ id: r.id, ...pick(r) })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      before.map((r) => ({ id: r.id, ...pick(r) })).sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it('runs once per date as a daily step', async () => {
    const deps = {
      db: f.db,
      clock: fixedClock(new Date('2026-11-05T18:05:00Z')),
      defer: () => {},
    } as unknown as Deps;
    const ctx = { deps, companyId: f.companyId, today: '2026-11-06', yesterday: '2026-11-05' };
    const run = () =>
      runJob(deps, f.companyId, closeDayStep.job, closeDayStep.runKey(ctx), (tx) =>
        closeDayStep.run(tx, ctx),
      );
    expect(await run()).toBe('succeeded');
    expect(await run()).toBe('skipped');
    const rows = await records('2026-11-05');
    expect(rows.find((r) => r.employeeId === ids.absent)?.status).toBe('absent');
  });
});
