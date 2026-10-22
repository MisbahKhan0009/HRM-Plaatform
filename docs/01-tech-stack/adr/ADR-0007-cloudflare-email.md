# ADR-0007: Email via Gmail API (no custom domain)

- Status: Accepted (2026-10-22, revised — supersedes the Cloudflare Email Service choice, which requires Workers Paid)

## Decision
No company domain exists (D-035). Send transactional email (sign-in codes, invitations, approval requests/decisions, reminders) through a **dedicated company Gmail account** using the **Gmail API** over HTTPS (OAuth2 refresh token stored as a Worker secret). Free, ~500 messages/day — far above need for <50 employees.

All sending goes through a `Mailer` interface (`packages/`) so a provider such as Resend can replace it when a domain is bought. Emails are written to the outbox and sent by the cron processor (ADR-0002); failures are retried and never roll back business state (FR-WF-008).

## Risks
- Gmail may rate-limit or flag automated mail; volumes are low. Monitor send failures in Sentry.
- Sign-in OTP delivery depends on this account: protect it with 2FA, restrict access to the owner + one backup admin.
