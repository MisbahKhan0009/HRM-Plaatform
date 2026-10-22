import { z } from 'zod';
import { CommentSchema, csvEnum, VersionSchema } from './common';
import { IsoDateSchema, PageQuerySchema } from './primitives';

// Leave module contracts (API-CATALOGUE §6, DOMAIN-MODEL §4 and §5.3, BUSINESS-RULES §3–§5).

export const leaveUnitValues = ['day', 'half_day'] as const;
export const halfDayPartValues = ['first_half', 'second_half'] as const;
export const leaveRequestStatusValues = [
  'draft',
  'pending',
  'approved',
  'rejected',
  'withdrawn',
  'cancellation_pending',
  'cancelled',
] as const;
export type LeaveRequestStatus = (typeof leaveRequestStatusValues)[number];
export const leaveLedgerTypeValues = [
  'grant',
  'accrual',
  'reservation',
  'reservation_release',
  'usage',
  'adjustment',
  'reversal',
  'carry_forward',
  'expiry',
] as const;
export const allocationMethodValues = [
  'annual_grant',
  'monthly_accrual',
  'per_days_worked',
  'manual',
] as const;
const leaveEligibleStatusValues = [
  'draft',
  'preboarding',
  'probation',
  'active',
  'notice_period',
  'separated',
  'archived',
] as const;

/** Leave quantity on the wire: a decimal string, never a JSON number (API-STANDARDS §3). */
export const LeaveQtySchema = z
  .string()
  .regex(/^\d{1,4}(\.\d{1,2})?$/, 'Expected a decimal string like "1.5"');
/** Signed quantity for HR adjustments. */
export const SignedLeaveQtySchema = z
  .string()
  .regex(/^-?\d{1,4}(\.\d{1,2})?$/, 'Expected a signed decimal string like "-1.5"')
  .refine((v) => !/^-?0+(\.0+)?$/.test(v), 'Must not be zero');

const auditFields = { version: z.number().int(), createdAt: z.string(), updatedAt: z.string() };
const trimmed = (max: number) => z.string().trim().min(1).max(max);
const LeaveYearSchema = z.coerce.number().int().min(2000).max(2100);

// Types and policies (FR-LEAVE-001, FR-LEAVE-002, D-013) ---------------------------------------------------------------

export const LeavePolicySchema = z.object({
  id: z.uuid(),
  leaveTypeId: z.uuid(),
  effectiveFrom: IsoDateSchema,
  effectiveTo: IsoDateSchema.nullable(),
  allocationMethod: z.enum(allocationMethodValues),
  annualEntitlement: LeaveQtySchema.nullable(),
  accrualPerMonth: LeaveQtySchema.nullable(),
  daysWorkedPerUnit: LeaveQtySchema.nullable(),
  prorateFirstYear: z.boolean(),
  eligibilityAfterDays: z.number().int(),
  eligibleStatuses: z.array(z.enum(leaveEligibleStatusValues)),
  maxCarryForward: LeaveQtySchema.nullable(),
  maxBalance: LeaveQtySchema.nullable(),
  carryForwardExpiryMonths: z.number().int().nullable(),
  allowNegativeBalance: z.boolean(),
  maxConsecutiveDays: LeaveQtySchema.nullable(),
  minNoticeDays: z.number().int(),
  ...auditFields,
});
export type LeavePolicy = z.infer<typeof LeavePolicySchema>;

export const LeaveTypeSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  isPaid: z.boolean(),
  allowsHalfDay: z.boolean(),
  requiresReason: z.boolean(),
  requiresDocumentAfterDays: LeaveQtySchema.nullable(),
  colorToken: z.string().nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  /** The policy in force today; null when the type has none yet. */
  currentPolicy: LeavePolicySchema.nullable(),
  ...auditFields,
});
export type LeaveType = z.infer<typeof LeaveTypeSchema>;

export const LeaveTypeCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2,10}$/, '2 to 10 letters');

const ColorTokenSchema = z.string().regex(/^[a-z0-9-]{1,40}$/, 'A design token name');

export const CreateLeaveTypeInputSchema = z
  .object({
    code: LeaveTypeCodeSchema,
    name: trimmed(80),
    isPaid: z.boolean().optional(),
    allowsHalfDay: z.boolean().optional(),
    requiresReason: z.boolean().optional(),
    requiresDocumentAfterDays: LeaveQtySchema.nullable().optional(),
    colorToken: ColorTokenSchema.nullable().optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
  })
  .strict();
export type CreateLeaveTypeInput = z.infer<typeof CreateLeaveTypeInputSchema>;

export const UpdateLeaveTypeInputSchema = z
  .object({
    name: trimmed(80).optional(),
    isPaid: z.boolean().optional(),
    allowsHalfDay: z.boolean().optional(),
    requiresReason: z.boolean().optional(),
    requiresDocumentAfterDays: LeaveQtySchema.nullable().optional(),
    colorToken: ColorTokenSchema.nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    version: VersionSchema,
  })
  .strict();
export type UpdateLeaveTypeInput = z.infer<typeof UpdateLeaveTypeInputSchema>;

export const LeaveTypeQuerySchema = z
  .object({
    includeInactive: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  })
  .strict();

const REQUIRED_PARAMETER = {
  annual_grant: 'annualEntitlement',
  monthly_accrual: 'accrualPerMonth',
  per_days_worked: 'daysWorkedPerUnit',
} as const;

export const CreateLeavePolicyInputSchema = z
  .object({
    effectiveFrom: IsoDateSchema,
    allocationMethod: z.enum(allocationMethodValues),
    annualEntitlement: LeaveQtySchema.nullable().optional(),
    accrualPerMonth: LeaveQtySchema.nullable().optional(),
    daysWorkedPerUnit: LeaveQtySchema.refine((v) => Number(v) > 0, 'Must be positive')
      .nullable()
      .optional(),
    prorateFirstYear: z.boolean().optional(),
    eligibilityAfterDays: z.number().int().min(0).max(3650).optional(),
    eligibleStatuses: z
      .array(z.enum(leaveEligibleStatusValues))
      .min(1)
      .max(7)
      .refine((s) => new Set(s).size === s.length, 'Statuses must be unique')
      .optional(),
    maxCarryForward: LeaveQtySchema.nullable().optional(),
    maxBalance: LeaveQtySchema.nullable().optional(),
    carryForwardExpiryMonths: z.number().int().min(1).max(24).nullable().optional(),
    allowNegativeBalance: z.boolean().optional(),
    maxConsecutiveDays: LeaveQtySchema.nullable().optional(),
    minNoticeDays: z.number().int().min(0).max(365).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const required = REQUIRED_PARAMETER[v.allocationMethod as keyof typeof REQUIRED_PARAMETER];
    if (required && !v[required])
      ctx.addIssue({ code: 'custom', path: [required], message: `Required for ${v.allocationMethod}` });
  });
export type CreateLeavePolicyInput = z.infer<typeof CreateLeavePolicyInputSchema>;

// Balances and ledger (FR-LEAVE-003, FR-LEAVE-008) ---------------------------------------------------------------------

export const LeaveBalanceSchema = z.object({
  employeeId: z.uuid(),
  employeeCode: z.string(),
  employeeName: z.string(),
  leaveTypeId: z.uuid(),
  leaveTypeCode: z.string(),
  leaveTypeName: z.string(),
  year: z.number().int(),
  entitled: z.string(),
  used: z.string(),
  reserved: z.string(),
  adjusted: z.string(),
  available: z.string(),
});
export type LeaveBalance = z.infer<typeof LeaveBalanceSchema>;

export const MyLeaveBalancesSchema = z.object({ year: z.number().int(), data: z.array(LeaveBalanceSchema) });
export type MyLeaveBalances = z.infer<typeof MyLeaveBalancesSchema>;

export const MyBalancesQuerySchema = z.object({ year: LeaveYearSchema.optional() }).strict();

export const BalancesQuerySchema = PageQuerySchema.extend({
  year: LeaveYearSchema.optional(),
  employeeId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  leaveTypeId: z.uuid().optional(),
}).strict();
export type BalancesQuery = z.infer<typeof BalancesQuerySchema>;

export const LeaveLedgerEntrySchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  leaveTypeId: z.uuid(),
  leaveTypeCode: z.string(),
  year: z.number().int(),
  type: z.enum(leaveLedgerTypeValues),
  amount: z.string(),
  effectiveDate: IsoDateSchema,
  leaveRequestId: z.uuid().nullable(),
  requestNumber: z.string().nullable(),
  reversesEntryId: z.uuid().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type LeaveLedgerEntry = z.infer<typeof LeaveLedgerEntrySchema>;

export const LeaveEmployeeParamSchema = z.object({ employeeId: z.uuid() });

export const LedgerQuerySchema = PageQuerySchema.extend({
  year: LeaveYearSchema.optional(),
  leaveTypeId: z.uuid().optional(),
}).strict();
export type LedgerQuery = z.infer<typeof LedgerQuerySchema>;

export const AdjustLeaveBalanceInputSchema = z
  .object({
    employeeId: z.uuid(),
    leaveTypeId: z.uuid(),
    year: z.number().int().min(2000).max(2100),
    amount: SignedLeaveQtySchema,
    reason: trimmed(500),
  })
  .strict();
export type AdjustLeaveBalanceInput = z.infer<typeof AdjustLeaveBalanceInputSchema>;

// Requests (FR-LEAVE-004…010, DOMAIN-MODEL 5.3) -------------------------------------------------------------------------

export const LeaveRequestSchema = z.object({
  id: z.uuid(),
  requestNumber: z.string(),
  employeeId: z.uuid(),
  employeeCode: z.string(),
  employeeName: z.string(),
  leaveTypeId: z.uuid(),
  leaveTypeCode: z.string(),
  leaveTypeName: z.string(),
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  unit: z.enum(leaveUnitValues),
  halfDayPart: z.enum(halfDayPartValues).nullable(),
  requestedUnits: LeaveQtySchema,
  reason: z.string().nullable(),
  status: z.enum(leaveRequestStatusValues),
  submittedAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionComment: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  /** Created by HR on the employee's behalf (D-014). */
  onBehalf: z.boolean(),
  ...auditFields,
});
export type LeaveRequestDto = z.infer<typeof LeaveRequestSchema>;

const leaveRequestFields = {
  leaveTypeId: z.uuid(),
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  unit: z.enum(leaveUnitValues).default('day'),
  halfDayPart: z.enum(halfDayPartValues).optional(),
  reason: trimmed(1000).optional(),
  /** HR on behalf of an employee (`leave.request.review.all`); omitted for one's own request. */
  employeeId: z.uuid().optional(),
};

const checkRequestShape = (
  v: { startDate: string; endDate: string; unit: string; halfDayPart?: string | undefined },
  ctx: z.RefinementCtx,
) => {
  if (v.endDate < v.startDate)
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date is before start date.' });
  if (v.unit === 'half_day' && v.startDate !== v.endDate)
    ctx.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'A half day starts and ends on the same date.',
    });
  if (v.unit === 'half_day' && !v.halfDayPart)
    ctx.addIssue({ code: 'custom', path: ['halfDayPart'], message: 'Choose first_half or second_half.' });
  if (v.unit === 'day' && v.halfDayPart)
    ctx.addIssue({ code: 'custom', path: ['halfDayPart'], message: 'Only for half days.' });
};

export const CreateLeaveRequestInputSchema = z
  .object(leaveRequestFields)
  .strict()
  .superRefine(checkRequestShape);
export type CreateLeaveRequestInput = z.infer<typeof CreateLeaveRequestInputSchema>;

export const PreviewLeaveRequestInputSchema = CreateLeaveRequestInputSchema;

export const LeaveRequestPreviewSchema = z.object({
  employeeId: z.uuid(),
  leaveTypeId: z.uuid(),
  year: z.number().int(),
  requestedUnits: LeaveQtySchema,
  /** The working dates counted (BUSINESS-RULES 3.1). */
  workingDates: z.array(IsoDateSchema),
  available: z.string(),
  availableAfter: z.string(),
  sufficientBalance: z.boolean(),
  overlapsExisting: z.boolean(),
});
export type LeaveRequestPreview = z.infer<typeof LeaveRequestPreviewSchema>;

export const LeaveRequestsQuerySchema = PageQuerySchema.extend({
  status: csvEnum(leaveRequestStatusValues).optional(),
  employeeId: z.uuid().optional(),
  leaveTypeId: z.uuid().optional(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  sort: z.enum(['startDate', '-startDate', 'requestNumber', '-requestNumber']).default('-startDate'),
}).strict();
export type LeaveRequestsQuery = z.infer<typeof LeaveRequestsQuerySchema>;

export const LeaveVersionInputSchema = z.object({ version: VersionSchema }).strict();
export type LeaveVersionInput = z.infer<typeof LeaveVersionInputSchema>;

export const CancelLeaveRequestInputSchema = z
  .object({ reason: CommentSchema.optional(), version: VersionSchema })
  .strict();
export type CancelLeaveRequestInput = z.infer<typeof CancelLeaveRequestInputSchema>;

// Calendar (FR-LEAVE-011) -----------------------------------------------------------------------------------------------

export const LeaveCalendarQuerySchema = z
  .object({ from: IsoDateSchema, to: IsoDateSchema })
  .strict()
  .superRefine((v, ctx) => {
    if (v.to < v.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'End before start.' });
    const days = (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 + 1;
    if (days > 92) ctx.addIssue({ code: 'custom', path: ['to'], message: 'At most 92 days.' });
  });
export type LeaveCalendarQuery = z.infer<typeof LeaveCalendarQuerySchema>;

export const LeaveCalendarEntrySchema = z.object({
  /** Present only when the caller may open the request. */
  requestId: z.uuid().optional(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  unit: z.enum(leaveUnitValues),
  halfDayPart: z.enum(halfDayPartValues).nullable(),
  status: z.enum(leaveRequestStatusValues),
  /** Absent unless the caller holds `leave.read.*` or the entry is their own (FR-LEAVE-011). */
  leaveType: z
    .object({ id: z.uuid(), code: z.string(), name: z.string(), colorToken: z.string().nullable() })
    .optional(),
});
export type LeaveCalendarEntry = z.infer<typeof LeaveCalendarEntrySchema>;

export const LeaveCalendarSchema = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  data: z.array(LeaveCalendarEntrySchema),
});
export type LeaveCalendar = z.infer<typeof LeaveCalendarSchema>;
