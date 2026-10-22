# Performance budgets

Status: **Accepted**, 2026-10-22. Budgets are enforced in CI where a free tool can measure them, and checked by hand before each release otherwise. Sources: NFR-PERF-001…004, ADR-0009, `docs/03-architecture/ARCHITECTURE.md` §8.

## 1. Budgets

| ID | Metric | Budget | Measured by | Enforced |
|---|---|---|---|---|
| PB-01 | Worker CPU time per request | **p99 ≤ 8 ms**; hard limit 10 ms on Workers Free (ADR-0009) | Cloudflare dashboard → Workers → `hrm-<env>` → Metrics → CPU time percentiles; locally with `wrangler dev` + DevTools profiler | Weekly review; release check |
| PB-02 | Worker CPU time per cron invocation | p99 ≤ 8 ms per dispatcher run | Same dashboard, filter by `scheduled` | Release check |
| PB-03 | Worker bundle size | **≤ 2 MB compressed** (platform limit 3 MB on Free) | `wrangler deploy --dry-run --outdir=dist-check`, then gzip the output | **CI fails** above budget |
| PB-04 | API latency, warm (common reads and writes) | **p95 ≤ 500 ms** (NFR-PERF-001) | Workers metrics (wall time); k6 script `scripts/perf/api.js` against staging | Release check |
| PB-05 | API latency, first request after Neon scale-to-zero | ≤ 2.5 s, accepted (ADR-0003) | Same k6 script, after 10 min idle | Release check (informational) |
| PB-06 | SPA initial JavaScript (sign-in and dashboard routes) | ≤ 200 KB gzipped | `pnpm --filter @hrm/web size` after `vite build`: entry chunk plus every statically imported chunk of each route, from `dist/.vite/manifest.json` | CI reports; becomes **CI fails** when both routes are within budget (D-047) |
| PB-07 | Per-route lazy chunk | ≤ 100 KB gzipped (payroll and reports may load PDF/XLSX libraries on demand, outside this budget) | Same | CI warning |
| PB-08 | LCP on mobile 4G | ≤ 2.5 s | Lighthouse CI (free, `@lhci/cli`) with mobile throttling on staging | Nightly; release check |
| PB-09 | INP | ≤ 200 ms | Lighthouse (lab proxy: TBT ≤ 200 ms); `web-vitals` field data sent to logs | Release check |
| PB-10 | CLS | ≤ 0.1 | Lighthouse CI | Nightly |
| PB-11 | List endpoints | Paginate; default 25, max 100 rows (NFR-PERF-002) | Contract test | CI |
| PB-12 | Payroll calculation for 50 employees | ≤ 8 ms CPU per request; calculation done in batches of ≤ 25 employees per request if measured CPU exceeds that | Benchmark test in `apps/api/test/perf` | Release check |
| PB-13 | Database size | ≤ 350 MB of the 0.5 GB Neon Free limit | `SELECT pg_size_pretty(pg_database_size(current_database()));` | Monthly (`docs/08-operations/FREE-TIER-MONITORING.md`) |

## 2. Keeping CPU under 10 ms

The free plan stops a request at 10 ms CPU and returns error 1102 (ADR-0009). Waiting on the network (database, R2, Gmail) does not count towards CPU; computation does.

Rules for developers:

1. Aggregations, filters, sorting and totals run in SQL, not in JavaScript loops over rows.
2. No password hashing (passwordless, ADR-0004). No PDF or XLSX generation in the Worker (D-037).
3. Large JSON responses are paginated; never serialise thousands of rows.
4. Zod parsing of large arrays is avoided: bulk endpoints (imports, payments import) accept at most 100 rows per request, and the client sends batches.
5. Cron jobs process small batches per run (for example 20 outbox messages) and rely on the next minute's run for the rest.
6. Avoid heavy libraries at module load. Startup work runs on each cold isolate.

How to find a CPU hotspot:

```bash
# local: start the worker with the inspector, then open chrome://inspect → Profiler
pnpm --filter @hrm/api exec wrangler dev --inspector-port 9229

# remote: tail live requests, including CPU time and outcome, for the staging worker
pnpm --filter @hrm/api exec wrangler tail hrm-staging --format pretty
```

An outcome of `exceededCpu` in `wrangler tail` is an error 1102. See `docs/08-operations/INCIDENT-RUNBOOKS.md` IR-02.

## 3. Frontend budgets

- Route-level code splitting through TanStack Router file routes; the PDF (`pdf-lib`) and XLSX (`exceljs`) libraries are imported dynamically only when the user clicks download or export.
- Fonts: Inter, Inter Tight and JetBrains Mono as self-hosted variable `woff2`, Latin subset, `font-display: swap`, preload only Inter.
- Images: the logo as SVG; no raster images above 100 KB.
- Lighthouse CI runs against staging with the mobile preset (Moto G Power, slow 4G, 4× CPU slowdown) on the sign-in page, dashboard, employee list and leave request page.

## 4. Neon cold start

Neon Free suspends compute after 5 minutes idle (ADR-0003). The first request afterwards waits for compute to start. This is accepted for v1. Mitigations that cost nothing:

- The SPA shell loads from static assets (no database), so the page appears at once and shows a loading state for data.
- The `/api/v1/health` probe is **not** scheduled to keep the database awake, because that would spend the 100 compute-hours/month allowance.
