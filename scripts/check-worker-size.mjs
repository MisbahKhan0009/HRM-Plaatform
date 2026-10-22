// Fails when the Worker bundle exceeds the free-tier guardrail (ADR-0009: keep under 2 MB gzip; hard limit 3 MB).
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const LIMIT = 2 * 1024 * 1024;
const file = new URL('../apps/api/dist/index.js', import.meta.url);
const size = gzipSync(readFileSync(file)).length;
console.log(`Worker bundle: ${(size / 1024).toFixed(1)} KiB gzip (limit ${LIMIT / 1024} KiB)`);
if (size > LIMIT) {
  console.error('Worker bundle is over budget. See docs/07-quality/PERFORMANCE-BUDGETS.md.');
  process.exit(1);
}
