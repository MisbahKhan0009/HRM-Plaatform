/**
 * Every email goes through this interface so the provider can change by configuration (ADR-0007).
 * v1 provider: Gmail API from a dedicated company account (D-035). The Gmail adapter lands in Stage 8.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Template name, recorded in email_deliveries. */
  template: string;
}

export interface SendResult {
  providerMessageId: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<SendResult>;
}

/** Development mailer: records messages in memory and never sends anything. */
export class MemoryMailer implements Mailer {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<SendResult> {
    this.sent.push(message);
    return { providerMessageId: `memory-${this.sent.length}` };
  }
}
