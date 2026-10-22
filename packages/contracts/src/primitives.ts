import { z } from 'zod';

/** Business date, `YYYY-MM-DD` in Asia/Dhaka (API-STANDARDS §3). */
export const IsoDateSchema = z.iso.date();

/** UTC timestamp with `Z` (API-STANDARDS §3). */
export const TimestampSchema = z.iso.datetime({ offset: false });

/** Money amount as a decimal string with exactly 2 places; never a JSON number (ADR-0006). */
export const MoneyAmountSchema = z
  .string()
  .regex(/^-?\d{1,12}\.\d{2}$/, 'Expected a decimal string like "45000.00"');

export const CurrencySchema = z.literal('BDT');

export const MoneySchema = z.object({ amount: MoneyAmountSchema, currency: CurrencySchema });
export type Money = z.infer<typeof MoneySchema>;

/** Page-based pagination query (API-STANDARDS §5). */
export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const PageMetaSchema = z.object({
  number: z.number().int(),
  size: z.number().int(),
  totalItems: z.number().int(),
  totalPages: z.number().int(),
});

export const themeValues = ['ink', 'paper'] as const;
export const ThemeSchema = z.enum(themeValues);
export type Theme = z.infer<typeof ThemeSchema>;
