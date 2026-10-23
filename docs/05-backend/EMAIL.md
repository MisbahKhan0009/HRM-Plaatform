# Email

Status: **Accepted**, 2026-10-22. Normative. Email is the only notification channel in v1 (D-025), sent through the Gmail API from a dedicated company Gmail account (D-035, ADR-0007). Delivery mechanics: `JOBS-AND-OUTBOX.md`.

## 1. Mailer interface

All sending goes through `packages/mailer`, so the provider can change (for example to Resend when the company buys a domain) without touching modules.

```ts
export interface OutgoingEmail {
  to: string;                     // one recipient per message; no CC/BCC lists of employees
  subject: string;
  text: string;                   // always present
  html: string;                   // always present
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface Mailer {
  send(email: OutgoingEmail): Promise<{ providerMessageId: string }>;
}

export class GmailApiMailer implements Mailer { /* section 2 */ }
export class ConsoleMailer implements Mailer { /* local dev: logs the message, writes nothing externally */ }
export class MemoryMailer implements Mailer { /* tests: stores messages for assertions */ }
```

The environment picks the implementation: `MAILER=gmail` in staging and production, `console` locally, `memory` in tests. Staging sends only to addresses on the `MAIL_ALLOWLIST` secret, so test data never emails a real person by mistake.

## 2. Gmail API adapter

- Endpoint: `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` with `{ raw: base64url(RFC 2822 message) }`.
- Auth: OAuth 2.0 refresh token for the sender account, scope `https://www.googleapis.com/auth/gmail.send` only. The adapter exchanges the refresh token at `https://oauth2.googleapis.com/token` for an access token (valid about 1 hour) and caches it in a module-level variable for the isolate's lifetime.
- Secrets (`wrangler secret put`): `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER` (the account address). One-time setup steps are in `docs/08-operations/ACCOUNT-SETUP.md`.
- The MIME message is built with a small hand-written builder (multipart/alternative, UTF-8, quoted-printable bodies, `Subject` encoded as RFC 2047). No heavy MIME library, to stay within the CPU budget.
- `From: "Big-Matrix HRM" <GMAIL_SENDER>`; `Reply-To` is HR's address from settings where useful.
- Errors: `429` and `5xx` are retryable (outbox backoff); `400` is permanent (mark `dead` at once); `401` triggers one token refresh and retry, then fails with an alert, because it usually means the refresh token was revoked.

## 3. Template catalogue

Templates live in `packages/mailer/src/templates/<name>.ts` and export `render(data, locale) => { subject, text, html }`. They are plain TypeScript functions with escaped interpolation, written for English with every string coming from a message catalogue keyed by locale, so Bangla can be added without code changes (D-003).

| Template (`topic` = `email.<name>`) | Recipient | Trigger | Content |
|---|---|---|---|
| `sign_in_code` | user | email OTP send (inline) | 6-digit code, expiry (10 min), "ignore if you did not ask" |
| `invitation` | invited user | `POST /users/invitations`, resend | Company name, inviter name, accept link (expires in 7 days) |
| `auth_reset` | user | admin `reset-auth` | Notice that sign-in methods were reset, link to sign in, contact HR if unexpected |
| `new_sign_in_method` | user | passkey or TOTP added/removed | Security notice |
| `approval_requested` | approver | leave request, correction, claim, profile change, payroll run submitted | What, who (requester name), key facts (dates, units or amount), link to the item |
| `request_decided` | requester | approve/reject of the above | Decision, reviewer comment if any; reviewer name hidden when `approvals.hide_reviewer` is true (FR-ESS-007) |
| `leave_cancellation_decided` | requester | cancellation approved/rejected | |
| `payroll_run_returned` | preparer | run returned | Reason |
| `payslip_published` | each employee in the run | `publish-payslips` | Period, link to payslip. **No amounts in the email** |
| `document_expiry_digest` | users with `document.manage` | daily dispatcher | List of documents and contracts expiring in 30/14/7/0 days, employee names and categories only |
| `job_failure_alert` | users with `system.health.read` | dead outbox message, failed job | Job name, time, link to health page |

Rules for all templates:

- Never include salary amounts, national ID numbers, personal contact details or document contents. Emails link to the app, where permissions apply.
- Links are absolute (`APP_ORIGIN` + path) and contain only ids, never tokens, except the invitation link (single use, hashed in the database).
- Subjects are short and specific: "Leave request approved: 3 to 5 Nov", "Your November 2026 payslip is ready".
- Every HTML email has an equivalent plain-text body. HTML uses inline styles, Arial (brand rule for email, `docs/02-brand/source/brand-book.md`), and the Paper theme colours, because many mail clients ignore dark-mode CSS.

## 4. Sign-in codes are sent inline

The user is waiting for the code, so `sendVerificationOTP` (AUTH-IMPLEMENTATION section 2) calls `mailer.send` directly inside the request instead of using the outbox. It writes an `email_deliveries` row with `outbox_message_id = NULL`. On failure the endpoint still returns `200` (to avoid account enumeration), logs the error, and the user can request a new code after the rate-limit window.

## 5. Limits and account protection

- Gmail allows roughly 500 messages per day from a consumer account. Expected volume is under 100 per day for 50 employees; the payslip run is about 50 messages once a month.
- Batching: reminders are digests (one email per HR user per day), not one email per document.
- If daily volume exceeds 300, the health page shows a warning (`FREE-TIER-MONITORING.md`).
- The sender Gmail account has 2-step verification, a strong unique password stored in the company password manager, recovery options owned by the company, and no other use. Only the owner and one backup admin can sign in to it. Because sign-in codes go through this account, losing it blocks email sign-in for everyone; passkeys keep working.
