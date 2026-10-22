import { ERROR_STATUS, type ErrorCode, type FieldError } from '@hrm/contracts';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** A business or HTTP error with a stable code from the catalogue (API-STANDARDS §7). */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly detail?: string,
    readonly errors: FieldError[] = [],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

interface ProblemInput {
  title?: string;
  detail?: string;
  errors?: FieldError[];
}

export function toProblem(err: unknown): { code: ErrorCode; status: number } & ProblemInput {
  if (err instanceof AppError) {
    return {
      code: err.code,
      status: ERROR_STATUS[err.code],
      title: err.message,
      detail: err.detail,
      errors: err.errors,
    };
  }
  // Never leak internals: no stack, no SQL (API-STANDARDS §7).
  return { code: 'INTERNAL_ERROR', status: 500, title: 'Internal error' };
}

export function problemResponse(c: Context, code: ErrorCode, input: ProblemInput = {}) {
  const status = ERROR_STATUS[code] as ContentfulStatusCode;
  const body = {
    type: `https://hrm.local/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title: input.title ?? code,
    status,
    code,
    ...(input.detail ? { detail: input.detail } : {}),
    requestId: (c.get('requestId') as string | undefined) ?? 'unknown',
    errors: input.errors ?? [],
  };
  return c.body(JSON.stringify(body), status, { 'Content-Type': 'application/problem+json' });
}
