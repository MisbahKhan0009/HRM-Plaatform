import { base64Url, buildMime } from './mime';
import { type Mailer, MailerError, type OutgoingEmail } from './types';

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** The dedicated company Gmail address (D-035). */
  sender: string;
  /** Staging only: recipients outside this list are dropped (EMAIL.md §1). */
  allowlist?: readonly string[];
  fetch?: typeof fetch;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

// One access token per isolate; valid for about an hour (EMAIL.md §2).
let cached: CachedToken | null = null;

/** Sends through the Gmail API with the `gmail.send` scope only (ADR-0007, D-035). */
export class GmailApiMailer implements Mailer {
  private readonly fetch: typeof fetch;

  constructor(private readonly config: GmailConfig) {
    // Wrapped, not stored: calling the global fetch as `this.fetch(...)` is an "Illegal invocation" in Workers.
    this.fetch = config.fetch ?? ((input, init) => fetch(input, init));
  }

  async send(email: OutgoingEmail) {
    const allow = this.config.allowlist;
    if (allow && !allow.some((a) => a.toLowerCase() === email.to.toLowerCase())) {
      return { providerMessageId: 'dropped-not-on-allowlist' };
    }
    const raw = base64Url(
      buildMime(email, `"Big-Matrix HRM" <${this.config.sender}>`, `hrm-${crypto.randomUUID()}`),
    );
    let res = await this.post(raw, await this.accessToken(false));
    if (res.status === 401) res = await this.post(raw, await this.accessToken(true));
    if (res.ok) {
      const body = (await res.json()) as { id?: string };
      return { providerMessageId: body.id ?? 'unknown' };
    }
    // 429 and 5xx are retryable; other 4xx are permanent (EMAIL.md §2).
    const retryable = res.status === 429 || res.status >= 500;
    throw new MailerError(`Gmail API returned ${res.status}`, retryable);
  }

  private post(raw: string, token: string) {
    return this.fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
  }

  private async accessToken(force: boolean): Promise<string> {
    if (!force && cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
    const res = await this.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      // invalid_grant means the refresh token was revoked: an operator must reconnect (INCIDENT-RUNBOOKS).
      throw new MailerError(`Gmail token refresh failed with ${res.status}`, res.status >= 500);
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    cached = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return cached.value;
  }
}

/** Test hook: forget the cached access token. */
export function resetGmailTokenCache() {
  cached = null;
}
