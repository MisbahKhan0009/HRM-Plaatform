import type { Mailer, OutgoingEmail } from './types';

/** Test mailer: stores messages for assertions and never sends anything. */
export class MemoryMailer implements Mailer {
  readonly sent: OutgoingEmail[] = [];
  /** When set, the next send fails with this error (tests for retries). */
  failNext: Error | null = null;

  async send(email: OutgoingEmail) {
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    this.sent.push(email);
    return { providerMessageId: `memory-${this.sent.length}` };
  }

  /** Most recent message to an address, if any. */
  lastTo(address: string): OutgoingEmail | undefined {
    return this.sent.findLast((m) => m.to.toLowerCase() === address.toLowerCase());
  }
}
