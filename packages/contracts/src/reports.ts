import { z } from 'zod';
import { csvEnum } from './common';
import { IsoDateSchema, MoneySchema, PageQuerySchema } from './primitives';

// Reports (API-CATALOGUE §12, FR-REP-001…006). Every report is paginated JSON; the browser builds CSV/XLSX (D-037).

export const reportNameValues = [
  'headcount',
  'directory',
  'attendance',
  'leave',
  'payroll_register',
  'payroll_deductions',
  'payment_reconciliation',
  'reimbursements',
] as const;
export const ReportNameSchema = z.enum(reportNameValues);
export type ReportName = z.infer<typeof ReportNameSchema>;

const employeeStatusValues = [
  'draft',
  'preboarding',
  'probation',
  'active',
  'notice_period',
  'separated',
  'archived',
] as const;
const EmployeeStatusSchema = z.enum(employeeStatusValues);

const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

/** `from`/`to` must be ordered and at most 366 days apart (API-STANDARDS §5). */
const rangeOk = (v: { from?: string | undefined; to?: string | undefined }) =>
  !v.from || !v.to || (v.to >= v.from && (Date.parse(v.to) - Date.parse(v.from)) / DAY_MS < MAX_RANGE_DAYS);
const rangeIssue = { message: 'Range must be ordered and at most 366 days', path: ['to'] };

/** Fields shared by rows that describe one employee. Names only: never salary or contact data (SECURITY-MODEL §5). */
const employeeRef = {
  employeeId: z.uuid(),
  employeeCode: z.string(),
  employeeName: z.string(),
  departmentName: z.string().nullable(),
};

const QuantitySchema = z.string().describe('Decimal string, for example "1.50"');

// Headcount (FR-REP-001) ------------------------------------------------------------------------------------------

export const headcountGroupValues = ['department', 'position', 'status'] as const;

export const HeadcountQuerySchema = PageQuerySchema.extend({
  asOf: IsoDateSchema.optional(),
  departmentId: z.uuid().optional(),
  groupBy: z.enum(headcountGroupValues).default('department'),
}).strict();
export type HeadcountQuery = z.infer<typeof HeadcountQuerySchema>;

export const HeadcountRowSchema = z.object({
  /** Department or position id; `null` for "none"; absent when grouping by status. */
  groupId: z.uuid().nullable().optional(),
  groupLabel: z.string().nullable(),
  total: z.number().int(),
  byStatus: z.record(EmployeeStatusSchema, z.number().int()),
});
export type HeadcountRow = z.infer<typeof HeadcountRowSchema>;

export const HeadcountSummarySchema = z.object({ asOf: z.string(), total: z.number().int() });

// Directory (FR-REP-001) ------------------------------------------------------------------------------------------

export const DirectoryQuerySchema = PageQuerySchema.extend({
  departmentId: z.uuid().optional(),
  status: csvEnum(employeeStatusValues).optional(),
}).strict();
export type DirectoryQuery = z.infer<typeof DirectoryQuerySchema>;

export const DirectoryRowSchema = z.object({
  ...employeeRef,
  status: EmployeeStatusSchema,
  positionTitle: z.string().nullable(),
  managerName: z.string().nullable(),
  workEmail: z.string().nullable(),
  workPhone: z.string().nullable(),
  joiningDate: z.string().nullable(),
});
export type DirectoryRow = z.infer<typeof DirectoryRowSchema>;

// Attendance (FR-REP-002, FR-ATT-011) -------------------------------------------------------------------------------

export const AttendanceReportQuerySchema = PageQuerySchema.extend({
  from: IsoDateSchema,
  to: IsoDateSchema,
  departmentId: z.uuid().optional(),
  employeeId: z.uuid().optional(),
})
  .strict()
  .refine(rangeOk, rangeIssue);
export type AttendanceReportQuery = z.infer<typeof AttendanceReportQuerySchema>;

export const AttendanceReportRowSchema = z.object({
  ...employeeRef,
  days: z.object({
    present: z.number().int(),
    shortHours: z.number().int(),
    missedCore: z.number().int(),
    missingPunch: z.number().int(),
    absent: z.number().int(),
    onLeave: z.number().int(),
    holiday: z.number().int(),
    weekend: z.number().int(),
  }),
  workedMinutes: z.number().int(),
  lateMinutes: z.number().int(),
  earlyLeaveMinutes: z.number().int(),
  needsReview: z.number().int(),
});
export type AttendanceReportRow = z.infer<typeof AttendanceReportRowSchema>;

// Leave (FR-REP-002) ------------------------------------------------------------------------------------------------

export const LeaveReportQuerySchema = PageQuerySchema.extend({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  leaveTypeId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
})
  .strict()
  .refine(rangeOk, rangeIssue)
  .refine((v) => (v.from === undefined) === (v.to === undefined), {
    message: 'Give both from and to, or neither',
    path: ['to'],
  });
export type LeaveReportQuery = z.infer<typeof LeaveReportQuerySchema>;

export const LeaveReportRowSchema = z.object({
  ...employeeRef,
  leaveTypeId: z.uuid(),
  leaveTypeCode: z.string(),
  leaveTypeName: z.string(),
  /** Balance for the leave year. */
  entitled: QuantitySchema,
  used: QuantitySchema,
  reserved: QuantitySchema,
  adjusted: QuantitySchema,
  available: QuantitySchema,
  /** Units of approved leave starting inside the period. */
  takenInPeriod: QuantitySchema,
});
export type LeaveReportRow = z.infer<typeof LeaveReportRowSchema>;

// Payroll register (FR-REP-003) -------------------------------------------------------------------------------------

export const PayrollRunReportQuerySchema = PageQuerySchema.extend({ runId: z.uuid() }).strict();
export type PayrollRunReportQuery = z.infer<typeof PayrollRunReportQuerySchema>;

const RunRefSchema = z.object({
  id: z.uuid(),
  runNumber: z.string(),
  status: z.string(),
  periodYear: z.number().int(),
  periodMonth: z.number().int(),
});

export const PayrollRegisterRowSchema = z.object({
  ...employeeRef,
  payrollItemId: z.uuid(),
  daysInPeriod: z.number().int(),
  daysEmployed: z.number().int(),
  grossAmount: MoneySchema,
  deductionAmount: MoneySchema,
  netAmount: MoneySchema,
  reimbursementAmount: MoneySchema,
  paymentStatus: z.string(),
  validationFlags: z.array(z.string()),
});
export type PayrollRegisterRow = z.infer<typeof PayrollRegisterRowSchema>;

export const PayrollTotalsSchema = z.object({
  employeeCount: z.number().int(),
  grossAmount: MoneySchema,
  deductionAmount: MoneySchema,
  netAmount: MoneySchema,
});

// Payroll deductions (FR-REP-003) -----------------------------------------------------------------------------------

export const PayrollDeductionsQuerySchema = PageQuerySchema.extend({
  runId: z.uuid().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
})
  .strict()
  .refine((v) => (v.runId === undefined) !== (v.year === undefined), {
    message: 'Give exactly one of runId or year',
    path: ['runId'],
  });
export type PayrollDeductionsQuery = z.infer<typeof PayrollDeductionsQuerySchema>;

export const PayrollDeductionRowSchema = z.object({
  ...employeeRef,
  runId: z.uuid(),
  runNumber: z.string(),
  periodYear: z.number().int(),
  periodMonth: z.number().int(),
  code: z.string(),
  label: z.string(),
  amount: MoneySchema,
});
export type PayrollDeductionRow = z.infer<typeof PayrollDeductionRowSchema>;

// Payment reconciliation (FR-REP-003, FR-PAY-015) -------------------------------------------------------------------

export const PaymentReconciliationRowSchema = z.object({
  ...employeeRef,
  payrollItemId: z.uuid(),
  grossAmount: MoneySchema,
  deductionAmount: MoneySchema,
  netAmount: MoneySchema,
  paidAmount: MoneySchema,
  /** Net minus paid; zero when the item is fully paid. */
  differenceAmount: MoneySchema,
  paymentCount: z.number().int(),
  methods: z.array(z.string()),
  lastPaidOn: z.string().nullable(),
  paymentStatus: z.string(),
});
export type PaymentReconciliationRow = z.infer<typeof PaymentReconciliationRowSchema>;

// Reimbursements (FR-REIM, FR-REP) ----------------------------------------------------------------------------------

export const reimbursementStatusValues = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'withdrawn',
  'included',
  'paid',
] as const;

/** Draft claims are the employee's own work in progress and never appear in the report. */
const reportedReimbursementStatusValues = [
  'submitted',
  'approved',
  'rejected',
  'withdrawn',
  'included',
  'paid',
] as const;

export const ReimbursementReportQuerySchema = PageQuerySchema.extend({
  from: IsoDateSchema,
  to: IsoDateSchema,
  status: csvEnum(reportedReimbursementStatusValues).optional(),
})
  .strict()
  .refine(rangeOk, rangeIssue);
export type ReimbursementReportQuery = z.infer<typeof ReimbursementReportQuerySchema>;

export const ReimbursementReportRowSchema = z.object({
  ...employeeRef,
  claimId: z.uuid(),
  claimNumber: z.string(),
  category: z.string(),
  expenseDate: z.string(),
  amount: MoneySchema,
  status: z.enum(reimbursementStatusValues),
  submittedAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  runNumber: z.string().nullable(),
});
export type ReimbursementReportRow = z.infer<typeof ReimbursementReportRowSchema>;

// Envelopes ---------------------------------------------------------------------------------------------------------

const PageMeta = z.object({
  number: z.number().int(),
  size: z.number().int(),
  totalItems: z.number().int(),
  totalPages: z.number().int(),
});

/** `{ data, page, summary }`: a paginated list plus whole-result totals computed in SQL. */
export const reportPage = <T extends z.ZodType, S extends z.ZodType>(row: T, summary: S) =>
  z.object({ data: z.array(row), page: PageMeta, summary });

export const PayrollRunReportSummarySchema = z.object({ run: RunRefSchema, totals: PayrollTotalsSchema });
export const ReconciliationSummarySchema = z.object({
  run: RunRefSchema,
  totals: PayrollTotalsSchema.extend({ paidAmount: MoneySchema, differenceAmount: MoneySchema }),
});
export const DeductionsSummarySchema = z.object({ totalAmount: MoneySchema });
export const ReimbursementSummarySchema = z.object({ count: z.number().int(), totalAmount: MoneySchema });

// Export log (FR-REP-005) -------------------------------------------------------------------------------------------

const FilterValueSchema = z.union([
  z.string().max(200),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(200)).max(20),
]);

/** `POST /reports/exports`: written to the audit log only; the file is built in the browser (D-037). */
export const ReportExportInputSchema = z
  .object({
    report: ReportNameSchema,
    format: z.enum(['csv', 'xlsx']).optional(),
    filters: z
      .record(z.string().max(40), FilterValueSchema)
      .refine((f) => Object.keys(f).length <= 20, 'At most 20 filters')
      .default({}),
    rowCount: z.number().int().min(0).max(1_000_000),
  })
  .strict();
export type ReportExportInput = z.infer<typeof ReportExportInputSchema>;
