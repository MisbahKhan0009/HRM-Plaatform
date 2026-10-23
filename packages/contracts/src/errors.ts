import { z } from 'zod';
import { ERROR_CODES } from './error-codes';

export { ERROR_CODES, ERROR_STATUS, type ErrorCode } from './error-codes';

/** One failing field in a validation error (JSON Pointer path). */
export const FieldErrorSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});

/** RFC 9457 problem details, as returned by every error response (API-STANDARDS §7). */
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(ERROR_CODES as [string, ...string[]]),
  detail: z.string().optional(),
  requestId: z.string(),
  errors: z.array(FieldErrorSchema).default([]),
});

export type Problem = z.infer<typeof ProblemSchema>;
export type FieldError = z.infer<typeof FieldErrorSchema>;
