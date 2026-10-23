import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import committed from '../openapi.json';

type Operation = {
  operationId?: string;
  tags?: string[];
  security?: unknown[];
  responses?: Record<string, unknown>;
};

const fetchDoc = async () =>
  (await (await exports.default.fetch(new Request('https://hrm.test/api/v1/openapi.json'))).json()) as {
    paths: Record<string, Record<string, Operation>>;
  };

// API-STANDARDS §12: the committed document matches the routes, and every operation is fully described.
describe('OpenAPI contract', () => {
  it('matches the committed apps/api/openapi.json (run `pnpm --filter @hrm/api openapi`)', async () => {
    const live = await fetchDoc();
    expect(Object.keys(live.paths).sort()).toEqual(
      Object.keys((committed as { paths: object }).paths).sort(),
    );
    for (const [path, ops] of Object.entries(live.paths)) {
      expect(Object.keys(ops).sort(), path).toEqual(
        Object.keys((committed as { paths: Record<string, object> }).paths[path] ?? {}).sort(),
      );
    }
  });

  it('gives every operation an operationId, tags and error responses', async () => {
    const live = await fetchDoc();
    const ids = new Set<string>();
    for (const [path, ops] of Object.entries(live.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        const where = `${method.toUpperCase()} ${path}`;
        expect(op.operationId, where).toBeTruthy();
        expect(ids.has(op.operationId as string), `duplicate operationId ${op.operationId}`).toBe(false);
        ids.add(op.operationId as string);
        expect(op.tags?.length, where).toBeGreaterThan(0);
        if (op.security?.length) expect(Object.keys(op.responses ?? {}), where).toContain('401');
      }
    }
  });
});
