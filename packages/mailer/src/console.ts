import type { Mailer, OutgoingEmail } from './types';

/**
 * Local development mailer: prints the plain-text body to the terminal running `wrangler dev`, so a developer can
 * read sign-in codes. Used only when MAILER=console, which is set for the local environment and never deployed.
 */
export class ConsoleMailer implements Mailer {
  private count = 0;

  async send(email: OutgoingEmail) {
    this.count += 1;
    console.log(`\n--- email to ${email.to}: ${email.subject}\n${email.text}\n---`);
    return { providerMessageId: `console-${this.count}` };
  }
}
