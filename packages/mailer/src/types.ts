/** One outgoing message; one recipient, never a list of employees (EMAIL.md §1). */
export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface Mailer {
  send(email: OutgoingEmail): Promise<{ providerMessageId: string }>;
}

/** A provider failure. `retryable` decides between outbox backoff and marking the message dead. */
export class MailerError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'MailerError';
  }
}
