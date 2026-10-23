import { ConsoleMailer, GmailApiMailer, type Mailer, MemoryMailer } from '@hrm/mailer';

/** Shared by API tests in the same isolate, so they can read sent sign-in codes and emails. */
export const memoryMailer = new MemoryMailer();
const consoleMailer = new ConsoleMailer();

/** MAILER selects the provider: gmail (staging, production), console (local), memory (tests). EMAIL.md §1. */
export function selectMailer(env: Env): Mailer {
  if (env.MAILER === 'memory') return memoryMailer;
  if (env.MAILER === 'console') return consoleMailer;
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN || !env.GMAIL_SENDER) {
    throw new Error(
      'MAILER=gmail needs GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN and GMAIL_SENDER',
    );
  }
  const allowlist = env.MAIL_ALLOWLIST?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new GmailApiMailer({
    clientId: env.GMAIL_CLIENT_ID,
    clientSecret: env.GMAIL_CLIENT_SECRET,
    refreshToken: env.GMAIL_REFRESH_TOKEN,
    sender: env.GMAIL_SENDER,
    ...(allowlist?.length ? { allowlist } : {}),
  });
}
