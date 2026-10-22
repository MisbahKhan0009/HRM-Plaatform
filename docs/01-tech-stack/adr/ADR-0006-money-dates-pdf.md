# ADR-0006: Money, dates and document generation

- Status: Accepted (2026-10-22)

## Decision
- Money: Postgres `NUMERIC(14,2)`; in TS use `decimal.js` (or string transport) — **JS `number` is forbidden for money** (FR-PAY-006). API serializes money as strings with explicit `currency: "BDT"`. Rounding: half-up to 2 decimals at line level; totals are sums of rounded lines.
- Proration (D-022): `gross × daysEmployed / daysInMonth`, computed in Decimal, rounded once.
- Dates: `YYYY-MM-DD` for dates, ISO-8601 UTC for timestamps in the API; business-date logic in `Asia/Dhaka` via `@date-fns/tz` (NFR-LOC-003).
- Payslip PDFs and XLSX/CSV exports are **generated in the browser** (`pdf-lib`, `exceljs`) from the immutable payroll snapshot returned by the API (D-037). The snapshot — not the PDF — is the record of truth; the same snapshot always renders the same payslip. Export endpoints still enforce permissions server-side (FR-REP-006).
