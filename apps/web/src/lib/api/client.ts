import type { FieldError } from '@hrm/contracts';

/** A problem+json response (API-STANDARDS §7). Messages are chosen by `code`, never by `detail`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly errors: FieldError[],
    readonly requestId: string | null,
    readonly retryAfter: number | null,
  ) {
    super(title);
    this.name = 'ApiError';
  }

  /** The first field error at a JSON Pointer path, for form fields. */
  fieldError(path: string) {
    return this.errors.find((e) => e.path === path);
  }
}

export class NetworkError extends Error {
  constructor() {
    super('Network request failed');
    this.name = 'NetworkError';
  }
}

/** The user closed the step-up dialog: treat as "nothing changed" (ARCHITECTURE §3). */
export class StepUpCancelledError extends Error {
  constructor() {
    super('Step-up cancelled');
    this.name = 'StepUpCancelledError';
  }
}

type StepUpReason = 'MFA_REQUIRED' | 'REAUTH_REQUIRED';
let stepUpHandler: ((reason: StepUpReason) => Promise<boolean>) | null = null;
let unauthenticatedHandler: (() => void) | null = null;

/** The step-up dialog registers itself here; the client opens it on 403 MFA_REQUIRED / REAUTH_REQUIRED. */
export function setStepUpHandler(handler: typeof stepUpHandler) {
  stepUpHandler = handler;
}

export function setUnauthenticatedHandler(handler: typeof unauthenticatedHandler) {
  unauthenticatedHandler = handler;
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Commands with money or ledger effects send an Idempotency-Key, reused on the step-up retry (API-STANDARDS §9). */
  idempotent?: boolean;
  signal?: AbortSignal;
  /** Skip the step-up dialog (the dialog's own calls). */
  noStepUp?: boolean;
}

export function buildUrl(path: string, query?: RequestOptions['query']) {
  const url = new URL(`/api/v1${path}`, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.pathname + url.search;
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as {
    code?: string;
    title?: string;
    errors?: FieldError[];
    requestId?: string;
  } | null;
  const retry = res.headers.get('Retry-After');
  return new ApiError(
    res.status,
    body?.code ?? (res.status >= 500 ? 'INTERNAL_ERROR' : 'FORBIDDEN'),
    body?.title ?? res.statusText,
    body?.errors ?? [],
    body?.requestId ?? res.headers.get('X-Request-Id'),
    retry ? Number(retry) : null,
  );
}

/** Same-origin fetch to /api/v1 with problem+json errors, step-up and 401 handling (ARCHITECTURE §4). */
export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotent) headers['Idempotency-Key'] = crypto.randomUUID();

  const send = async () => {
    try {
      return await fetch(buildUrl(path, options.query), {
        method,
        headers,
        credentials: 'same-origin',
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new NetworkError();
    }
  };

  return handleResponse<T>(path, send, options.noStepUp ?? false);
}

/**
 * Shared by `request` and `upload` (lib/api/upload.ts): opens the step-up dialog on 403 MFA_REQUIRED or
 * REAUTH_REQUIRED and retries once, reports 401, and turns other failures into an ApiError.
 */
export async function handleResponse<T>(
  path: string,
  send: () => Promise<Response>,
  noStepUp: boolean,
): Promise<T> {
  let res = await send();
  if (res.status === 403 && !noStepUp && stepUpHandler) {
    const err = await toApiError(res.clone());
    if (err.code === 'MFA_REQUIRED' || err.code === 'REAUTH_REQUIRED') {
      const ok = await stepUpHandler(err.code);
      if (!ok) throw new StepUpCancelledError();
      res = await send();
    }
  }
  if (res.status === 401 && path !== '/auth/me' && unauthenticatedHandler) unauthenticatedHandler();
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, { ...options, body: body ?? {} }),
  patch: <T>(path: string, body: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, { ...options, body }),
  del: <T = void>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
};
