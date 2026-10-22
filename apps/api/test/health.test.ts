import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const call = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://hrm.test${path}`, init));

describe('GET /api/v1/health', () => {
  it('returns ok with the standard API headers', async () => {
    const res = await call('/api/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'hrm-api' });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });

  it('echoes a well-formed request id', async () => {
    const res = await call('/api/v1/health', { headers: { 'X-Request-Id': 'req-12345678' } });
    expect(res.headers.get('X-Request-Id')).toBe('req-12345678');
  });
});

describe('unknown API routes', () => {
  it('ask for a session first, so routes cannot be probed anonymously', async () => {
    const res = await call('/api/v1/nope');
    expect(res.status).toBe(401);
    expect(res.headers.get('Content-Type')).toBe('application/problem+json');
    const body = (await res.json()) as { code: string; requestId: string };
    expect(body.code).toBe('UNAUTHENTICATED');
    expect(body.requestId).toBe(res.headers.get('X-Request-Id'));
  });
});

describe('OpenAPI document', () => {
  it('lists the health operation', async () => {
    const doc = (await (await call('/api/v1/openapi.json')).json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toContain('/api/v1/health');
  });
});
