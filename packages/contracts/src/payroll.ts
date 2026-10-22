import { z } from 'zod';
import { CommentSchema, csvEnum, VersionSchema } from './common';
import { IsoDateSchema, MoneySchema, PageQuerySchema } from './primitives';
import { PositiveMoneySchema } from './reimbursements';

// Payroll (API-CATALOGUE §8, BUSINESS-RULES §6, DOMAIN-MODEL 5.6–5.7). Money is `{ amount, currency }` with a string
// amount (ADR-0006).

export const payrollRunStatusValues = [
  'draft',
  'calculated',
  'submitted',
  'returned',
  'approved',
  'locked',
  'paid',
  'reconciled',
] as const;
export const PayrollRunStatusSchema = z.enum(payrollRunStatusValues);
export type PayrollRunStatus = z.infer<typeof PayrollRunStatusSchema>;

export const payrollRunTypeValues = ['regular', 'off_cycle'] as const;
export const PayrollRunTypeSchema = z.enum(payrollRunTypeValues);

export const salaryStructureStatusValues = ['draft', 'approved', 'superseded'] as const;
export const adjustmentStatusValues = ['pending', 'approved', 'rejected', 'applied'] as const;
export type AdjustmentStatus = (typeof adjustmentStatusValues)[number];
export const adjustmentTypeValues = ['addition', 'deduction'] as const;
export const adjustmentLineCodeValues = ['addition', 'deduction', 'arrears'] as const;
export const paymentMethodValues = ['cash', 'cheque'] as const;
export const paymentStatusValues = ['unpaid', 'paid', 'failed', 'cancelled'] as const;
export const payrollLineKindValues = ['earning', 'deduction'] as const;
export const payrollLineCodeValues = [
  'base_salary',
  'reimbursement',
  'addition',
  'deduction',
  'proration_adjustment',
  'arrears',
] as const;

/** Validation flags (BUSINESS-RULES 6.5). The first three block `submit`. */
export const payrollFlagValues = [
  'no_salary_structure',
  'negative_net',
  'currency_mismatch',
  'zero_net',
  'joiner',
  'leaver',
  'net_change_over_threshold',
  'large_reimbursement',
] as const;
export const PayrollFlagSchema = z.enum(payrollFlagValues);
export type PayrollFlag = z.infer<typeof PayrollFlagSchema>;

const auditFields = { version: z.number().int(), createdAt: z.string(), updatedAt: z.string() };
const EmployeeRefSchema = z.object({ id: z.uuid(), employeeCode: z.string(), name: z.string() });

/** A non-negative money amount (salary may be zero). */
const NonNegativeMoneySchema = MoneySchema.extend({
  amount: z.string().regex(/^\d{1,12}\.\d{2}$/, 'Expected a decimal string like "45000.00"'),
});

// Salary structures (FR-PAY-001, FR-PAY-003, D-018) ------------------------------------------------------------------

export const SalaryStructureSchema = z.object({
  id: z.uuid(),
  employee: EmployeeRefSchema,
  grossAmount: MoneySchema,
  effectiveFrom: IsoDateSchema,
  effectiveTo: IsoDateSchema.nullable(),
  status: z.enum(salaryStructureStatusValues),
  reason: z.string().nullable(),
  approvedAt: z.string().nullable(),
  ...auditFields,
});
export type SalaryStructure = z.infer<typeof SalaryStructureSchema>;

export const CreateSalaryStructureInputSchema = z
  .object({
    employeeId: z.uuid(),
    grossAmount: NonNegativeMoneySchema,
    effectiveFrom: IsoDateSchema,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type CreateSalaryStructureInput = z.infer<typeof CreateSalaryStructureInputSchema>;

export const VersionInputSchema = z.object({ version: VersionSchema }).strict();
export type VersionInput = z.infer<typeof VersionInputSchema>;

export const SalaryStructureQuerySchema = PageQuerySchema.extend({
  employeeId: z.uuid().optional(),
}).strict();
export type SalaryStructureQuery = z.infer<typeof SalaryStructureQuerySchema>;

// Periods (FR-PAY-004) -----------------------------------------------------------------------------------------------

export const PayrollPeriodSchema = z.object({
  id: z.uuid(),
  year: z.number().int(),
  month: z.number().int(),
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  status: z.enum(['open', 'closed']),
  ...auditFields,
});
export type PayrollPeriod = z.infer<typeof PayrollPeriodSchema>;

export const CreatePayrollPeriodInputSchema = z
  .object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) })
  .strict();
export type CreatePayrollPeriodInput = z.infer<typeof CreatePayrollPeriodInputSchema>;

export const PayrollPeriodQuerySchema = PageQuerySchema.extend({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
}).strict();

// Runs ---------------------------------------------------------------------------------------------------------------

const TotalsSchema = z.object({ gross: MoneySchema, deductions: MoneySchema, net: MoneySchema });

export const ValidationSummarySchema = z.object({
  /** Top-level code `submit` would return, or null (API-STANDARDS "Payroll blocking codes"). */
  blockingCode: z.string().nullable(),
  blockingItems: z.number().int(),
  warningItems: z.number().int(),
  byFlag: z.record(z.string(), z.number().int()),
});

export const PayrollRunSchema = z.object({
  id: z.uuid(),
  runNumber: z.string(),
  period: z.object({
    id: z.uuid(),
    year: z.number().int(),
    month: z.number().int(),
    startDate: IsoDateSchema,
    endDate: IsoDateSchema,
  }),
  runType: PayrollRunTypeSchema,
  status: PayrollRunStatusSchema,
  calculationRuleVersion: z.string().nullable(),
  calculatedAt: z.string().nullable(),
  submittedAt: z.string().nullable(),
  preparedBy: z.uuid().nullable(),
  /** Name of the user who prepared the run; null while nobody has. */
  preparedByName: z.string().nullable(),
  approvedAt: z.string().nullable(),
  approvedBy: z.uuid().nullable(),
  /** Name of the approving user; null until approved. */
  approvedByName: z.string().nullable(),
  selfApproved: z.boolean(),
  selfApprovalNote: z.string().nullable(),
  returnedReason: z.string().nullable(),
  lockedAt: z.string().nullable(),
  payslipsPublishedAt: z.string().nullable(),
  employeeCount: z.number().int().nullable(),
  /** Null until the run is calculated. */
  totals: TotalsSchema.nullable(),
  /** Present on `GET /payroll/runs/{id}` only. */
  validation: ValidationSummarySchema.optional(),
  ...auditFields,
});
export type PayrollRun = z.infer<typeof PayrollRunSchema>;

export const CreatePayrollRunInputSchema = z
  .object({ periodId: z.uuid(), runType: PayrollRunTypeSchema.default('regular') })
  .strict();
export type CreatePayrollRunInput = z.infer<typeof CreatePayrollRunInputSchema>;

export const PayrollRunQuerySchema = PageQuerySchema.extend({
  periodId: z.uuid().optional(),
  status: csvEnum(payrollRunStatusValues).optional(),
}).strict();
export type PayrollRunQuery = z.infer<typeof PayrollRunQuerySchema>;

export const ReturnPayrollRunInputSchema = z
  .object({ reason: CommentSchema, version: VersionSchema })
  .strict();
export type ReturnPayrollRunInput = z.infer<typeof ReturnPayrollRunInputSchema>;

/** `selfApprovalNote` is required (at least 20 characters) when the approver prepared or submitted the run (D-007). */
export const ApprovePayrollInputSchema = z
  .object({
    version: VersionSchema,
    comment: CommentSchema.optional(),
    selfApprovalNote: z.string().trim().max(1000).optional(),
  })
  .strict();
export type ApprovePayrollInput = z.infer<typeof ApprovePayrollInputSchema>;

// Items --------------------------------------------------------------------------------------------------------------

export const PayrollItemSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  employee: EmployeeRefSchema,
  grossAmount: MoneySchema,
  deductionAmount: MoneySchema,
  netAmount: MoneySchema,
  daysEmployed: z.number().int(),
  daysInPeriod: z.number().int(),
  validationFlags: z.array(PayrollFlagSchema),
  paymentStatus: z.enum(paymentStatusValues),
  ...auditFields,
});
export type PayrollItem = z.infer<typeof PayrollItemSchema>;

export const PayrollLineSchema = z.object({
  id: z.uuid(),
  kind: z.enum(payrollLineKindValues),
  code: z.enum(payrollLineCodeValues),
  label: z.string(),
  amount: MoneySchema,
  sortOrder: z.number().int(),
  sourceType: z.string().nullable(),
  sourceId: z.uuid().nullable(),
  calculation: z.record(z.string(), z.unknown()),
});

export const PayrollItemDetailSchema = PayrollItemSchema.extend({
  lines: z.array(PayrollLineSchema),
  /** Immutable calculation snapshot (BUSINESS-RULES 6.6). */
  snapshot: z.record(z.string(), z.unknown()),
});
export type PayrollItemDetail = z.infer<typeof PayrollItemDetailSchema>;

export const PayrollItemQuerySchema = PageQuerySchema.extend({
  employeeId: z.uuid().optional(),
  flag: PayrollFlagSchema.optional(),
}).strict();
export type PayrollItemQuery = z.infer<typeof PayrollItemQuerySchema>;

export const RunItemParamSchema = z.object({ id: z.uuid(), itemId: z.uuid() });

export const PayrollValidationSchema = z.object({
  runId: z.uuid(),
  summary: ValidationSummarySchema,
  /** Every item with at least one flag. */
  items: z.array(
    z.object({ payrollItemId: z.uuid(), employee: EmployeeRefSchema, flags: z.array(PayrollFlagSchema) }),
  ),
});
export type PayrollValidation = z.infer<typeof PayrollValidationSchema>;

// Payments (FR-PAY-014, D-021) ---------------------------------------------------------------------------------------

export const PayrollPaymentSchema = z.object({
  id: z.uuid(),
  payrollItemId: z.uuid(),
  employee: EmployeeRefSchema,
  method: z.enum(paymentMethodValues),
  amount: MoneySchema,
  paidOn: IsoDateSchema,
  chequeNumber: z.string().nullable(),
  reference: z.string().nullable(),
  acknowledgedByName: z.string().nullable(),
  status: z.enum(paymentStatusValues),
  cancelledReason: z.string().nullable(),
  ...auditFields,
});
export type PayrollPayment = z.infer<typeof PayrollPaymentSchema>;

/** `GET /payroll/runs/{id}/payments`: every payment of the run, newest first per employee. */
export const RunPaymentQuerySchema = PageQuerySchema.extend({
  status: csvEnum(paymentStatusValues).optional(),
}).strict();
export type RunPaymentQuery = z.infer<typeof RunPaymentQuerySchema>;

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

/** Cheques need a cheque number; cash needs an acknowledgment reference (US-PAY-007). */
export const RecordPaymentInputSchema = z
  .object({
    payrollItemId: z.uuid(),
    method: z.enum(paymentMethodValues),
    amount: PositiveMoneySchema,
    paidOn: IsoDateSchema,
    chequeNumber: optionalText(40),
    reference: optionalText(200),
    acknowledgedByName: optionalText(200),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.method === 'cheque' && !v.chequeNumber)
      ctx.addIssue({ code: 'custom', path: ['chequeNumber'], message: 'Required for a cheque.' });
    if (v.method === 'cash' && !v.reference)
      ctx.addIssue({
        code: 'custom',
        path: ['reference'],
        message: 'Cash acknowledgment reference is required.',
      });
  });
export type RecordPaymentInput = z.infer<typeof RecordPaymentInputSchema>;

export const ImportPaymentsInputSchema = z.object({ csv: z.string().min(1).max(200_000) }).strict();
export type ImportPaymentsInput = z.infer<typeof ImportPaymentsInputSchema>;

export const ImportPaymentsQuerySchema = z
  .object({
    dryRun: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  })
  .strict();

export const PaymentImportResultSchema = z.object({
  dryRun: z.boolean(),
  /** True when the file was applied (never on a dry run, and never when any row has errors). */
  applied: z.boolean(),
  validRows: z.number().int(),
  invalidRows: z.number().int(),
  rows: z.array(
    z.object({
      line: z.number().int(),
      employeeCode: z.string(),
      payrollItemId: z.uuid().nullable(),
      method: z.string(),
      amount: z.string(),
      paidOn: z.string(),
      chequeNumber: z.string().nullable(),
      errors: z.array(z.object({ code: z.string(), message: z.string() })),
    }),
  ),
});
export type PaymentImportResult = z.infer<typeof PaymentImportResultSchema>;

/** `outcome: failed` records a bounced cheque or failed cash hand-over; `cancelled` a wrong entry (PAY-11). */
export const CancelPaymentInputSchema = z
  .object({ reason: CommentSchema, outcome: z.enum(['cancelled', 'failed']).default('cancelled') })
  .strict();
export type CancelPaymentInput = z.infer<typeof CancelPaymentInputSchema>;

export const PaymentIdParamSchema = z.object({ paymentId: z.uuid() });

export const ReconciliationSchema = z.object({
  runId: z.uuid(),
  runNumber: z.string(),
  status: PayrollRunStatusSchema,
  totals: z.object({
    gross: MoneySchema,
    deductions: MoneySchema,
    net: MoneySchema,
    paid: MoneySchema,
    outstanding: MoneySchema,
  }),
  /** True when every item's paid amount equals its net amount. */
  balanced: z.boolean(),
  items: z.array(
    z.object({
      payrollItemId: z.uuid(),
      employee: EmployeeRefSchema,
      gross: MoneySchema,
      deductions: MoneySchema,
      net: MoneySchema,
      paid: MoneySchema,
      outstanding: MoneySchema,
      paymentStatus: z.enum(paymentStatusValues),
      /** `payment_failed`, `payment_cancelled`, `unpaid`. */
      exceptions: z.array(z.string()),
    }),
  ),
});
export type Reconciliation = z.infer<typeof ReconciliationSchema>;

export const PublishPayslipsResultSchema = z.object({
  runId: z.uuid(),
  published: z.number().int(),
  publishedAt: z.string(),
});
export type PublishPayslipsResult = z.infer<typeof PublishPayslipsResultSchema>;

// Adjustments (FR-PAY-011, D-019, DOMAIN-MODEL 5.7) -------------------------------------------------------------------

export const PayrollAdjustmentSchema = z.object({
  id: z.uuid(),
  employee: EmployeeRefSchema,
  type: z.enum(adjustmentTypeValues),
  lineCode: z.enum(adjustmentLineCodeValues),
  amount: MoneySchema,
  reason: z.string(),
  targetPeriodId: z.uuid(),
  correctsPayrollItemId: z.uuid().nullable(),
  status: z.enum(adjustmentStatusValues),
  decidedAt: z.string().nullable(),
  selfApproved: z.boolean(),
  selfApprovalNote: z.string().nullable(),
  appliedPayrollItemId: z.uuid().nullable(),
  /** The user who created the adjustment; approving one's own adjustment needs a self-approval note (D-007). */
  createdByUserId: z.uuid().nullable(),
  createdByName: z.string().nullable(),
  ...auditFields,
});
export type PayrollAdjustment = z.infer<typeof PayrollAdjustmentSchema>;

/** `lineCode` defaults to the type; `arrears` is an addition (PAY-10). */
export const CreateAdjustmentInputSchema = z
  .object({
    employeeId: z.uuid(),
    type: z.enum(adjustmentTypeValues),
    lineCode: z.enum(adjustmentLineCodeValues).optional(),
    amount: PositiveMoneySchema,
    reason: z.string().trim().min(5).max(1000),
    targetPeriodId: z.uuid(),
    correctsPayrollItemId: z.uuid().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.lineCode) return;
    const ok = v.type === 'deduction' ? v.lineCode === 'deduction' : v.lineCode !== 'deduction';
    if (!ok)
      ctx.addIssue({ code: 'custom', path: ['lineCode'], message: 'Does not match the adjustment type.' });
  });
export type CreateAdjustmentInput = z.infer<typeof CreateAdjustmentInputSchema>;

export const AdjustmentQuerySchema = PageQuerySchema.extend({
  status: csvEnum(adjustmentStatusValues).optional(),
  employeeId: z.uuid().optional(),
  periodId: z.uuid().optional(),
}).strict();
export type AdjustmentQuery = z.infer<typeof AdjustmentQuerySchema>;

// Payslips (FR-PAY-013, D-037) ---------------------------------------------------------------------------------------

export const PayslipSummarySchema = z.object({
  id: z.uuid(),
  employee: EmployeeRefSchema,
  period: z.object({ id: z.uuid(), year: z.number().int(), month: z.number().int() }),
  runNumber: z.string(),
  netAmount: MoneySchema,
  publishedAt: z.string(),
  firstViewedAt: z.string().nullable(),
});
export type PayslipSummary = z.infer<typeof PayslipSummarySchema>;

/** Immutable payslip content from the item snapshot; the browser renders the PDF from it (D-037). */
export const PayslipDataSchema = z.object({
  id: z.uuid(),
  company: z.object({ name: z.string(), legalName: z.string().nullable(), address: z.string().nullable() }),
  employee: z.object({
    id: z.uuid(),
    employeeCode: z.string(),
    name: z.string(),
    department: z.string().nullable(),
    position: z.string().nullable(),
    joiningDate: IsoDateSchema.nullable(),
    separationDate: IsoDateSchema.nullable(),
  }),
  period: z.object({
    id: z.uuid(),
    year: z.number().int(),
    month: z.number().int(),
    startDate: IsoDateSchema,
    endDate: IsoDateSchema,
    daysInPeriod: z.number().int(),
  }),
  runNumber: z.string(),
  daysEmployed: z.number().int(),
  lines: z.array(
    z.object({
      kind: z.enum(payrollLineKindValues),
      code: z.enum(payrollLineCodeValues),
      label: z.string(),
      amount: MoneySchema,
    }),
  ),
  totals: TotalsSchema,
  ruleVersion: z.string(),
  paymentStatus: z.enum(paymentStatusValues),
  /** The item's `paid` payment; null while the item is unpaid. */
  payment: z
    .object({
      method: z.enum(paymentMethodValues),
      paidOn: IsoDateSchema,
      chequeNumber: z.string().nullable(),
    })
    .nullable(),
  publishedAt: z.string(),
  firstViewedAt: z.string().nullable(),
});
export type PayslipData = z.infer<typeof PayslipDataSchema>;

export const PayslipQuerySchema = PageQuerySchema.extend({
  employeeId: z.uuid().optional(),
  periodId: z.uuid().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
}).strict();
export type PayslipQuery = z.infer<typeof PayslipQuerySchema>;

export const OwnPayslipQuerySchema = PageQuerySchema.extend({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
}).strict();
