# ADR-0002: Cloudflare Workers platform (single Worker, R2, Queues, Cron)

- Status: Accepted (2026-10-22)

## Decision
- One Worker (`apps/api`) serves `/api/v1/*` and the built SPA via Workers Static Assets → same origin, `SameSite=Lax` HttpOnly cookies, simple CSRF model.
- **R2** private bucket for documents, receipts and payslips (no public bucket, no public URLs — FR-DOC-008). Downloads go through an authorized endpoint; any signed URL expires ≤ 5 min.
- **Queues** for async work (emails, exports, PDF generation) so failures never roll back committed business transactions (FR-WF-008). Consumer may live in the same Worker or a separate `apps/worker-jobs`.
- **Cron Triggers** for scheduled jobs (leave accrual, year-end carry-forward, document expiry reminders).
- Workers **Paid** plan required (CPU limits, Queues, Email Sending).

## Consequences
+ No servers to patch; HTTPS, DDoS protection and global edge included.
− Request CPU time limits: large reports/exports must be queued jobs (NFR-PERF-003).
− Vendor lock-in mitigated by keeping domain logic framework-agnostic (plain TS services) and Postgres as the system of record.
