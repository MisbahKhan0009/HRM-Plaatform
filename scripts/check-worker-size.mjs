// Checks the production Worker bundle (built with `--env production`):
// - size stays under the free-tier guardrail (ADR-0009: keep under 2 MB gzip; hard limit 3 MB);
// - test-only routes are absent (TESTING-STRATEGY §4: the marker __test_login must not ship).
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const LIMIT = 2 * 1024 * 1024;
const dir = new URL('../apps/api/dist/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
let total = 0;
for (const f of files) {
  const code = readFileSync(new URL(f, dir));
  total += gzipSync(code).length;
  if (code.includes('__test_login')) {
    console.error(`Test-only routes found in the production bundle (${f}).`);
    process.exit(1);
  }
}
console.log(
  `Worker bundle: ${(total / 1024).toFixed(1)} KiB gzip (limit ${LIMIT / 1024} KiB); no test routes`,
);
if (total > LIMIT) {
  console.error('Worker bundle is over budget. See docs/07-quality/PERFORMANCE-BUDGETS.md.');
  process.exit(1);
}
