import { ProblemSchema } from '@hrm/contracts';
import type { z } from 'zod';

const DESCRIPTIONS: Record<number, string> = {
  400: 'Invalid input (VALIDATION_FAILED)',
  401: 'Not signed in',
  403: 'Not allowed (FORBIDDEN, MFA_REQUIRED, REAUTH_REQUIRED, SELF_APPROVAL_FORBIDDEN, CSRF_ORIGIN_MISMATCH)',
  404: 'Not found or outside your scope',
  409: 'Conflict (VERSION_CONFLICT, INVALID_TRANSITION, DUPLICATE, ...)',
  413: 'File too large',
  415: 'Unsupported file type',
  422: 'Business rule violation',
  429: 'Too many requests',
};

/** Problem+json responses for the given statuses (API-STANDARDS §12: every operation lists its errors). */
export function problemResponses<S extends number>(...statuses: S[]) {
  return Object.fromEntries(
    statuses.map((s) => [
      s,
      {
        description: DESCRIPTIONS[s] ?? 'Error',
        content: { 'application/problem+json': { schema: ProblemSchema } },
      },
    ]),
  ) as Record<
    S,
    { description: string; content: { 'application/problem+json': { schema: typeof ProblemSchema } } }
  >;
}

export const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
});

export const jsonContent = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

/** Session cookie auth (API-STANDARDS §4); referenced by every protected operation. */
export const SESSION_SECURITY = [{ sessionCookie: [] as string[] }];
