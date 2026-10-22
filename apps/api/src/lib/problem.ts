import { ERROR_STATUS, type ErrorCode, type FieldError } from '@hrm/contracts';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** A business or HTTP error with a stable code from the catalogue (API-STANDARDS §7). The status comes from the code. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly detail?: string,
    readonly errors: FieldError[] = [],
    readonly headers: Record<string, string> = {},
  ) {
    super(message ?? code);
    this.name = 'AppError';
  }
}

export const notFound = () => new AppError('NOT_FOUND', 'Not found');
export const forbidden = () => new AppError('FORBIDDEN', 'Forbidden');
export const versionConflict = () =>
  new AppError(
    'VERSION_CONFLICT',
    'Version conflict',
    'Someone else changed this record. Reload and try again.',
  );
export const invalidTransition = (from: string, action: string) =>
  new AppError('INVALID_TRANSITION', 'Invalid transition', `Cannot ${action} from status ${from}.`);
export const ruleViolation = (detail: string, errors: FieldError[] = []) =>
  new AppError('BUSINESS_RULE_VIOLATION', 'Business rule violation', detail, errors);
export const validationFailed = (errors: FieldError[]) =>
  new AppError('VALIDATION_FAILED', 'Invalid input', undefined, errors);

interface ProblemInput {
  title?: string;
  detail?: string | undefined;
  errors?: FieldError[];
}

export function toProblem(
  err: unknown,
): { code: ErrorCode; status: number; headers?: Record<string, string> } & ProblemInput {
  if (err instanceof AppError) {
    return {
      code: err.code,
      status: ERROR_STATUS[err.code],
      title: err.message,
      detail: err.detail,
      errors: err.errors,
      headers: err.headers,
    };
  }
  // Never leak internals: no stack, no SQL (API-STANDARDS §7).
  return { code: 'INTERNAL_ERROR', status: 500, title: 'Internal error' };
}

export function problemResponse(
  c: Context,
  code: ErrorCode,
  input: ProblemInput = {},
  headers: Record<string, string> = {},
) {
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
  return c.body(JSON.stringify(body), status, { 'Content-Type': 'application/problem+json', ...headers });
}
