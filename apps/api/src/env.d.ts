// Secrets are not in wrangler.jsonc (they are set with `wrangler secret put`), so their types are declared here.
// SECRETS.md lists every secret and where it comes from.
interface Env {
  BETTER_AUTH_SECRET: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  GMAIL_SENDER?: string;
  /** Staging only: comma-separated addresses that may receive email. */
  MAIL_ALLOWLIST?: string;
  SENTRY_DSN?: string;
}

/** Build-time flag (wrangler `define`): true only for local and test builds; staging/production builds drop test routes. */
declare const __TEST_ROUTES__: boolean;
