import { z } from 'zod';
import { csvEnum, VersionSchema } from './common';
import { IsoDateSchema, PageQuerySchema, TimestampSchema } from './primitives';

// Attendance (API-CATALOGUE §5, BUSINESS-RULES §2, DOMAIN-MODEL §4).

export const attendanceStatusValues = [
  'present',
  'short_hours',
  'missed_core',
  'missing_punch',
  'absent',
  'on_leave',
  'holiday',
  'weekend',
  'not_employed',
] as const;
export const AttendanceStatusSchema = z.enum(attendanceStatusValues);
export type AttendanceStatus = z.infer<typeof AttendanceStatusSchema>;

export const attendanceEventTypeValues = ['check_in', 'check_out', 'manual_entry', 'correction'] as const;
export const AttendanceEventTypeSchema = z.enum(attendanceEventTypeValues);
export type AttendanceEventType = z.infer<typeof AttendanceEventTypeSchema>;

export const attendanceSourceValues = ['web', 'manual', 'correction', 'system'] as const;
export const AttendanceSourceSchema = z.enum(attendanceSourceValues);
export type AttendanceSource = z.infer<typeof AttendanceSourceSchema>;

export const attendanceCorrectionStatusValues = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export const AttendanceCorrectionStatusSchema = z.enum(attendanceCorrectionStatusValues);
export type AttendanceCorrectionStatus = z.infer<typeof AttendanceCorrectionStatusSchema>;

const EmployeeRefSchema = z.object({ id: z.uuid(), employeeCode: z.string(), name: z.string() });

/** One employee's derived day (`attendance_records`). Lateness is reported only (D-010). */
export const AttendanceRecordSchema = z.object({
  id: z.uuid(),
  employee: EmployeeRefSchema,
  workDate: z.string(),
  status: AttendanceStatusSchema,
  firstInAt: z.string().nullable(),
  lastOutAt: z.string().nullable(),
  workedMinutes: z.number().int(),
  lateMinutes: z.number().int(),
  earlyLeaveMinutes: z.number().int(),
  workScheduleId: z.uuid().nullable(),
  isFinal: z.boolean(),
  /** A check-out after midnight (D-011). */
  needsReview: z.boolean(),
  hasCorrection: z.boolean(),
  hasManualEntry: z.boolean(),
  computedAt: z.string(),
  version: z.number().int(),
});
export type AttendanceRecord = z.infer<typeof AttendanceRecordSchema>;

/** An immutable punch, manual entry or correction (FR-ATT-002, FR-ATT-008). IP and user agent are evidence only (D-009). */
export const AttendanceEventSchema = z.object({
  id: z.uuid(),
  type: AttendanceEventTypeSchema,
  source: AttendanceSourceSchema,
  workDate: z.string(),
  occurredAt: z.string(),
  recordedAt: z.string(),
  checkInAt: z.string().nullable(),
  checkOutAt: z.string().nullable(),
  correctionId: z.uuid().nullable(),
  reason: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  recordedByName: z.string().nullable(),
});
export type AttendanceEvent = z.infer<typeof AttendanceEventSchema>;

export const AttendanceDayDetailSchema = z.object({
  employee: EmployeeRefSchema,
  workDate: z.string(),
  record: AttendanceRecordSchema.nullable(),
  events: z.array(AttendanceEventSchema),
});
export type AttendanceDayDetail = z.infer<typeof AttendanceDayDetailSchema>;

/** Check-in and check-out take no input: the employee comes from the session (FR-ATT-012); other keys are ignored. */
export const PunchInputSchema = z
  .object({})
  .describe('Empty object. Any employeeId sent is ignored (FR-ATT-012).');

export const PunchResultSchema = z.object({ event: AttendanceEventSchema, record: AttendanceRecordSchema });
export type PunchResult = z.infer<typeof PunchResultSchema>;

export const attendanceTodayStateValues = ['not_checked_in', 'checked_in', 'checked_out'] as const;

/** Today's panel on "My attendance" (SCREEN-INVENTORY §3.1). */
export const AttendanceTodaySchema = z.object({
  workDate: z.string(),
  state: z.enum(attendanceTodayStateValues),
  openCheckInAt: z.string().nullable(),
  record: AttendanceRecordSchema.nullable(),
  schedule: z
    .object({
      id: z.uuid(),
      name: z.string(),
      coreStart: z.string(),
      coreEnd: z.string(),
      minDailyMinutes: z.number().int(),
      breakMinutes: z.number().int(),
      isWorkingDay: z.boolean(),
    })
    .nullable(),
});
export type AttendanceToday = z.infer<typeof AttendanceTodaySchema>;

const MAX_RANGE_DAYS = 366;
const dayNumber = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
const rangeOk = (v: { from?: string | undefined; to?: string | undefined }) =>
  !v.from || !v.to || (v.to >= v.from && dayNumber(v.to) - dayNumber(v.from) + 1 <= MAX_RANGE_DAYS);
const rangeIssue = { message: 'to must be on or after from, at most 366 days', path: ['to'] };

export const attendanceSortValues = ['workDate', '-workDate'] as const;

/** `GET /attendance/me`: defaults to the current month up to today. */
export const MyAttendanceQuerySchema = PageQuerySchema.extend({
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  sort: z.enum(attendanceSortValues).default('-workDate'),
})
  .strict()
  .refine(rangeOk, rangeIssue);
export type MyAttendanceQuery = z.infer<typeof MyAttendanceQuerySchema>;

export const MyAttendanceResponseSchema = z.object({
  data: z.array(AttendanceRecordSchema),
  page: z.object({
    number: z.number().int(),
    size: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
  }),
  today: AttendanceTodaySchema,
});
export type MyAttendanceResponse = z.infer<typeof MyAttendanceResponseSchema>;

/** `GET /attendance`: a date range is required (API-STANDARDS §5). */
export const AttendanceListQuerySchema = PageQuerySchema.extend({
  from: IsoDateSchema,
  to: IsoDateSchema,
  employeeId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  status: csvEnum(attendanceStatusValues).optional(),
  needsReview: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sort: z.enum(attendanceSortValues).default('-workDate'),
})
  .strict()
  .refine(rangeOk, rangeIssue);
export type AttendanceListQuery = z.infer<typeof AttendanceListQuerySchema>;

export const AttendanceDayParamSchema = z.object({ employeeId: z.uuid(), workDate: IsoDateSchema });

/** `GET /attendance/summary`: per-employee counts per status (FR-ATT-011). */
export const AttendanceSummaryQuerySchema = PageQuerySchema.extend({
  from: IsoDateSchema,
  to: IsoDateSchema,
  employeeId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
})
  .strict()
  .refine(rangeOk, rangeIssue);
export type AttendanceSummaryQuery = z.infer<typeof AttendanceSummaryQuerySchema>;

export const AttendanceSummaryRowSchema = z.object({
  employee: EmployeeRefSchema.extend({ departmentName: z.string().nullable() }),
  counts: z.object(
    Object.fromEntries(attendanceStatusValues.map((s) => [s, z.number().int()])) as Record<
      AttendanceStatus,
      z.ZodNumber
    >,
  ),
  workedMinutes: z.number().int(),
  lateMinutes: z.number().int(),
  earlyLeaveMinutes: z.number().int(),
  needsReview: z.number().int(),
});
export type AttendanceSummaryRow = z.infer<typeof AttendanceSummaryRowSchema>;

const ReasonSchema = z.string().trim().min(5).max(1000);

/** `POST /attendance/manual-entries` (FR-ATT-009): a full pair asserted by HR with a reason. */
export const CreateManualEntryInputSchema = z
  .object({
    employeeId: z.uuid(),
    workDate: IsoDateSchema,
    checkInAt: TimestampSchema,
    checkOutAt: TimestampSchema,
    reason: ReasonSchema,
  })
  .strict()
  .refine((v) => Date.parse(v.checkOutAt) > Date.parse(v.checkInAt), {
    message: 'Check-out must be after check-in',
    path: ['checkOutAt'],
  });
export type CreateManualEntryInput = z.infer<typeof CreateManualEntryInputSchema>;

export const AttendanceCorrectionSchema = z.object({
  id: z.uuid(),
  employee: EmployeeRefSchema,
  workDate: z.string(),
  status: AttendanceCorrectionStatusSchema,
  proposedCheckInAt: z.string().nullable(),
  proposedCheckOutAt: z.string().nullable(),
  reason: z.string(),
  decidedAt: z.string().nullable(),
  decisionComment: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AttendanceCorrection = z.infer<typeof AttendanceCorrectionSchema>;

/** `POST /attendance/corrections` (FR-ATT-006): at least one proposed time; the employee comes from the session. */
export const CreateAttendanceCorrectionInputSchema = z
  .object({
    workDate: IsoDateSchema,
    proposedCheckInAt: TimestampSchema.nullable().optional(),
    proposedCheckOutAt: TimestampSchema.nullable().optional(),
    reason: ReasonSchema,
  })
  .strict()
  .refine((v) => Boolean(v.proposedCheckInAt || v.proposedCheckOutAt), {
    message: 'Propose a check-in or a check-out time',
    path: ['proposedCheckInAt'],
  })
  .refine(
    (v) =>
      !v.proposedCheckInAt ||
      !v.proposedCheckOutAt ||
      Date.parse(v.proposedCheckOutAt) > Date.parse(v.proposedCheckInAt),
    {
      message: 'Check-out must be after check-in',
      path: ['proposedCheckOutAt'],
    },
  );
export type CreateAttendanceCorrectionInput = z.infer<typeof CreateAttendanceCorrectionInputSchema>;

export const AttendanceCorrectionListQuerySchema = PageQuerySchema.extend({
  status: csvEnum(attendanceCorrectionStatusValues).optional(),
  employeeId: z.uuid().optional(),
}).strict();
export type AttendanceCorrectionListQuery = z.infer<typeof AttendanceCorrectionListQuerySchema>;

export const WithdrawAttendanceCorrectionInputSchema = z.object({ version: VersionSchema }).strict();
export type WithdrawAttendanceCorrectionInput = z.infer<typeof WithdrawAttendanceCorrectionInputSchema>;
