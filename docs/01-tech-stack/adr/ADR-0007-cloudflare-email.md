# ADR-0007: Cloudflare Email Service for transactional email

- Status: Accepted (2026-10-22)

## Decision
Send invitations, password resets and approval/decision emails through **Cloudflare Email Service (Email Sending)** using the Worker `send_email` binding. Email is the only notification channel in v1 (D-025). Emails are enqueued (Queues) after the business transaction commits; failures are retried and surfaced to admins, never rolling back state (FR-WF-008).

## Risks
Email Sending is in **public beta** (since 2026-04) with account-level daily quotas. Mitigation: all sending goes through a `Mailer` interface in `packages/` so a fallback provider (e.g. Resend) can be swapped in by config. Domain must have SPF/DKIM/DMARC configured.
