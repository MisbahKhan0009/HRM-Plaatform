import { z } from 'zod';
import { csvEnum, VersionSchema } from './common';
import { IsoDateSchema, MoneySchema, PageQuerySchema } from './primitives';

// Reimbursement claims (API-CATALOGUE §7, D-020, FR-REIM-001…004, DOMAIN-MODEL 5.5)

export const claimStatusValues = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'withdrawn',
  'included',
  'paid',
] as const;
export const ClaimStatusSchema = z.enum(claimStatusValues);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

export const reimbursementCategoryValues = ['transport'] as const;

/** A positive money amount in BDT (amount > 0). */
export const PositiveMoneySchema = MoneySchema.extend({
  amount: z
    .string()
    .regex(/^\d{1,12}\.\d{2}$/, 'Expected a positive decimal string like "350.00"')
    .refine((s) => /[1-9]/.test(s), 'Must be greater than zero'),
});

const EmployeeRefSchema = z.object({ id: z.uuid(), employeeCode: z.string(), name: z.string() });

/** `ReimbursementClaim` DTO. The reviewer's identity is never included (FR-ESS-007). */
export const ReimbursementClaimSchema = z.object({
  id: z.uuid(),
  claimNumber: z.string(),
  employee: EmployeeRefSchema,
  category: z.enum(reimbursementCategoryValues),
  expenseDate: IsoDateSchema,
  amount: MoneySchema,
  description: z.string(),
  receiptDocumentId: z.uuid().nullable(),
  status: ClaimStatusSchema,
  submittedAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionComment: z.string().nullable(),
  /** The payroll run that includes the claim, once `included` or `paid` (US-REIM-003). */
  payrollRunNumber: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ReimbursementClaim = z.infer<typeof ReimbursementClaimSchema>;

const DescriptionSchema = z.string().trim().min(3).max(1000);

export const CreateClaimInputSchema = z
  .object({
    category: z.enum(reimbursementCategoryValues).default('transport'),
    expenseDate: IsoDateSchema,
    amount: PositiveMoneySchema,
    description: DescriptionSchema,
    receiptDocumentId: z.uuid().nullable().optional(),
  })
  .strict();
export type CreateClaimInput = z.infer<typeof CreateClaimInputSchema>;

export const UpdateClaimInputSchema = z
  .object({
    expenseDate: IsoDateSchema.optional(),
    amount: PositiveMoneySchema.optional(),
    description: DescriptionSchema.optional(),
    receiptDocumentId: z.uuid().nullable().optional(),
    version: VersionSchema,
  })
  .strict();
export type UpdateClaimInput = z.infer<typeof UpdateClaimInputSchema>;

/** Body of submit and withdraw. */
export const ClaimActionInputSchema = z.object({ version: VersionSchema }).strict();
export type ClaimActionInput = z.infer<typeof ClaimActionInputSchema>;

export const ClaimListQuerySchema = PageQuerySchema.extend({
  status: csvEnum(claimStatusValues).optional(),
  employeeId: z.uuid().optional(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
}).strict();
export type ClaimListQuery = z.infer<typeof ClaimListQuerySchema>;
