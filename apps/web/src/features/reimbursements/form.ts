import { IsoDateSchema } from '@hrm/contracts';
import { z } from 'zod';
import { ApiError } from '../../lib/api/client';
import { todayIso } from '../../lib/format';

const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * `"350"` → `"350.00"`, `"1,850.5"` → `"1850.50"`: the decimal string the API expects (ADR-0006). Text only; the
 * amount is never turned into a JavaScript number. Returns null when the input is not an amount.
 */
export function normaliseAmount(input: string): string | null {
  const clean = input.trim().replaceAll(',', '');
  if (!AMOUNT.test(clean)) return null;
  const [int = '0', frac = ''] = clean.split('.');
  const digits = int.replace(/^0+(?=\d)/, '');
  return `${digits}.${frac.padEnd(2, '0')}`;
}

/** Form values for a transport claim; the amount stays the text the user typed until it is sent. */
export const ClaimFormSchema = z.object({
  expenseDate: z
    .string()
    .refine((d) => IsoDateSchema.safeParse(d).success, 'Enter the date of travel.')
    .refine((d) => d <= todayIso(), "The date of travel can't be in the future."),
  amount: z
    .string()
    .trim()
    .refine((s) => normaliseAmount(s) !== null, 'Enter an amount in taka, for example 350 or 350.50.')
    .refine((s) => /[1-9]/.test(s), 'The amount must be more than zero.'),
  description: z
    .string()
    .trim()
    .min(3, 'Describe the trip in a few words.')
    .max(1000, 'Keep the description under 1,000 characters.'),
});
export type ClaimFormValues = z.input<typeof ClaimFormSchema>;
export type ClaimFormOutput = z.output<typeof ClaimFormSchema>;

/** The money object of the claim contracts. */
export const toMoney = (amount: string) => ({
  amount: normaliseAmount(amount) ?? amount,
  currency: 'BDT' as const,
});

/** The API reports amount errors at `/amount/amount`; the form has one `amount` field. */
export function flattenAmountErrors(error: unknown): unknown {
  if (!(error instanceof ApiError) || !error.errors.some((e) => e.path.startsWith('/amount/'))) return error;
  return new ApiError(
    error.status,
    error.code,
    error.title,
    error.errors.map((e) => (e.path.startsWith('/amount/') ? { ...e, path: '/amount' } : e)),
    error.requestId,
    error.retryAfter,
  );
}
