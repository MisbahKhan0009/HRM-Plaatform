import { type Health, HealthSchema, type Problem, ProblemSchema } from '@hrm/contracts';

/** Thrown for any non-2xx API response; `problem.code` drives the translated message (CONTENT-STYLE §6). */
export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.title);
    this.name = 'ApiError';
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...init });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ProblemSchema.safeParse(body);
    throw new ApiError(
      parsed.success
        ? parsed.data
        : {
            type: 'about:blank',
            title: 'Request failed',
            status: res.status,
            code: 'INTERNAL_ERROR',
            requestId: 'unknown',
            errors: [],
          },
    );
  }
  return body;
}

export const api = {
  health: async (): Promise<Health> => HealthSchema.parse(await request('/health')),
};
