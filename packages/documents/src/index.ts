/**
 * Browser-side document builders (D-037): payslip PDF (pdf-lib) and CSV/XLSX exports.
 * They run in the browser so the Worker stays within its 10 ms CPU budget (ADR-0009).
 * Report exports (CSV and XLSX) are also served from `@hrm/documents/export`, loaded on demand.
 */

export { toCsv } from './csv';
