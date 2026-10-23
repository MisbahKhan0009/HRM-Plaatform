// Writes apps/api/openapi.json from the route definitions (API-STANDARDS §12). CI regenerates it and fails on a diff.
import { writeFileSync } from 'node:fs';

(globalThis as { __TEST_ROUTES__?: boolean }).__TEST_ROUTES__ = false;
const { app } = await import('../src/app');
const doc = app.getOpenAPI31Document({
  openapi: '3.1.0',
  info: { title: 'Big-Matrix HRM API', version: 'v1' },
});
writeFileSync(new URL('../openapi.json', import.meta.url), `${JSON.stringify(doc, null, 2)}\n`);
console.log(`openapi.json: ${Object.keys(doc.paths ?? {}).length} paths`);
