# ADR-0002: Cloudflare Workers platform (single Worker, R2, Queues, Cron)

- Status: Accepted (2026-10-22)

## Decision
- One Worker (`apps/api`) serves `/api/v1/*` and the built SPA via Workers Static Assets → same origin, `SameSite=Lax` HttpOnly cookies, simple CSRF model.
- **R2** private bucket for documents, receipts and payslips (no public bucket, no public URLs — FR-DOC-008). Downloads go through an authorized endpoint; any signed URL expires ≤ 5 min.
- **Async work via a transactional outbox** (revised by D-036): business transactions insert rows into an `outbox` table in the same DB transaction; a **Cron Trigger every minute** processes a small batch (send emails, retries with backoff, dead-letter after N attempts). Failures never roll back committed business state (FR-WF-008). No Cloudflare Queues.
- **Cron Triggers** also run scheduled jobs (leave accrual, year-end carry-forward, document expiry reminders), mostly as SQL so CPU stays low.
- Runs on the **Workers Free** plan (D-032); see ADR-0009 for limits.

## Consequences
+ No servers to patch; HTTPS, DDoS protection and global edge included.
− 10 ms CPU per request on Free: heavy work goes to SQL or the browser (ADR-0009).
− Vendor lock-in mitigated by keeping domain logic framework-agnostic (plain TS services) and Postgres as the system of record.
