// PB-06 (docs/07-quality/PERFORMANCE-BUDGETS.md): initial JavaScript for the sign-in and dashboard routes must stay
// at or under 200 KB gzipped. Run after `vite build`; reads dist/.vite/manifest.json and exits 1 over budget.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET = 200 * 1024;
const dist = new URL('../dist/', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8'));

const ROUTES = {
  'sign-in': ['src/routes/(auth)/sign-in/index.tsx?tsr-split=component'],
  dashboard: ['src/routes/_app.tsx?tsr-split=component', 'src/routes/_app/dashboard.tsx?tsr-split=component'],
};

/** A chunk and its static imports, transitively (dynamic imports load later and are not counted). */
function closure(keys, seen = new Set()) {
  for (const key of keys) {
    if (seen.has(key)) continue;
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Missing chunk in manifest: ${key}`);
    seen.add(key);
    closure(chunk.imports ?? [], seen);
  }
  return seen;
}

const gzipSize = (key) => gzipSync(readFileSync(join(dist, manifest[key].file)), { level: 9 }).length;
const entry = Object.keys(manifest).filter((k) => manifest[k].isEntry);

let failed = false;
for (const [name, keys] of Object.entries(ROUTES)) {
  const total = [...closure([...entry, ...keys])].reduce((sum, key) => sum + gzipSize(key), 0);
  const over = total > BUDGET;
  failed ||= over;
  console.log(
    `${over ? 'FAIL' : 'ok  '} ${name}: ${(total / 1024).toFixed(1)} KB gzip (budget ${BUDGET / 1024} KB)`,
  );
}
process.exit(failed ? 1 : 0);
