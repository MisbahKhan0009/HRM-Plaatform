import { adjustmentStatusValues, payrollRunStatusValues } from '@hrm/contracts';
import { z } from 'zod';

// Route search schemas (zod `.default().catch()`). Kept apart from the pages: `validateSearch` stays in the entry
// bundle while route components are split, so importing a page module here would pull it into the initial JS.

const page = z.number().int().min(1).default(1).catch(1);
const pageSize = z.number().int().min(1).max(100).default(25).catch(25);

export const runListSearch = z.object({
  page,
  pageSize,
  status: z.enum(payrollRunStatusValues).optional().catch(undefined),
  periodId: z.uuid().optional().catch(undefined),
});

export const RUN_TABS = [
  'items',
  'validation',
  'adjustments',
  'payments',
  'reconciliation',
  'history',
] as const;
export type RunTab = (typeof RUN_TABS)[number];

export const runSearch = z.object({
  tab: z.enum(RUN_TABS).default('items').catch('items'),
  item: z.uuid().optional().catch(undefined),
  page,
  flag: z.string().max(40).optional().catch(undefined),
});
export type RunPageSearch = z.output<typeof runSearch>;

export const structureSearch = z.object({
  page,
  pageSize,
  employeeId: z.uuid().optional().catch(undefined),
});

export const adjustmentSearch = z.object({
  page,
  pageSize,
  status: z.enum(adjustmentStatusValues).optional().catch(undefined),
  periodId: z.uuid().optional().catch(undefined),
});

export const payslipSearch = z.object({
  page,
  pageSize,
  year: z.number().int().min(2000).max(2100).optional().catch(undefined),
  scope: z.enum(['mine', 'all']).optional().catch(undefined),
  employeeId: z.uuid().optional().catch(undefined),
});
export type PayslipSearch = z.output<typeof payslipSearch>;
