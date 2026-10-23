import { describe, expect, it } from 'vitest';
import { GmailApiMailer, resetGmailTokenCache } from './gmail';
import { buildMime, encodeHeader } from './mime';
import { renderEmail, TEMPLATE_NAMES } from './templates';
import { MailerError } from './types';

describe('templates', () => {
  it('escapes interpolated values in HTML but keeps them readable in text', () => {
    const r = renderEmail('invitation', {
      companyName: 'A&B <Ltd>',
      inviterName: 'Rahim "R" Uddin',
      acceptUrl: 'https://hrm.example/accept-invite?token=x',
    });
    expect(r.html).toContain('A&amp;B &lt;Ltd&gt;');
    expect(r.html).not.toContain('<Ltd>');
    expect(r.text).toContain('A&B <Ltd>');
    expect(r.text).toContain('https://hrm.example/accept-invite?token=x');
  });

  it('never puts money-looking amounts in the payslip email', () => {
    const r = renderEmail('payslip_published', { periodLabel: 'November 2026', url: 'https://x/payslips/1' });
    expect(r.text).not.toMatch(/\d+\.\d{2}/);
    expect(r.subject).toBe('Your November 2026 payslip is ready');
  });

  it('renders every template with a subject, text and html', () => {
    expect(TEMPLATE_NAMES.length).toBe(11);
  });
});

describe('MIME builder', () => {
  it('encodes non-ASCII subjects as RFC 2047 words', () => {
    expect(encodeHeader('ছুটি')).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    expect(encodeHeader('Leave approved')).toBe('Leave approved');
  });

  it('builds multipart/alternative with both bodies', () => {
    const mime = buildMime(
      { to: 'a@example.test', subject: 'Hi', text: 't', html: '<p>h</p>' },
      'x@example.test',
      'b1',
    );
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="b1"');
    expect(mime).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(mime).toContain('Content-Type: text/html; charset=UTF-8');
    expect(mime.trimEnd().endsWith('--b1--')).toBe(true);
  });
});

describe('GmailApiMailer', () => {
  const config = { clientId: 'id', clientSecret: 'secret', refreshToken: 'rt', sender: 'hrm@example.test' };
  const email = { to: 'a@example.test', subject: 'Hi', text: 't', html: 'h' };

  function fakeFetch(sendStatuses: number[]) {
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(url);
      if (url.includes('oauth2'))
        return Response.json({ access_token: `tok${calls.length}`, expires_in: 3600 });
      const status = sendStatuses.shift() ?? 200;
      return status === 200 ? Response.json({ id: 'gm-1' }) : new Response('{}', { status });
    }) as unknown as typeof fetch;
    return { f, calls };
  }

  it('exchanges the refresh token once and sends', async () => {
    resetGmailTokenCache();
    const { f, calls } = fakeFetch([200, 200]);
    const mailer = new GmailApiMailer({ ...config, fetch: f });
    expect(await mailer.send(email)).toEqual({ providerMessageId: 'gm-1' });
    await mailer.send(email);
    expect(calls.filter((c) => c.includes('oauth2'))).toHaveLength(1);
  });

  it('refreshes the token once on 401', async () => {
    resetGmailTokenCache();
    const { f, calls } = fakeFetch([401, 200]);
    await new GmailApiMailer({ ...config, fetch: f }).send(email);
    expect(calls.filter((c) => c.includes('oauth2'))).toHaveLength(2);
  });

  it('marks 429 and 5xx retryable and 400 permanent', async () => {
    resetGmailTokenCache();
    const retry = new GmailApiMailer({ ...config, fetch: fakeFetch([503]).f });
    await expect(retry.send(email)).rejects.toMatchObject({ retryable: true });
    const permanent = new GmailApiMailer({ ...config, fetch: fakeFetch([400]).f });
    await expect(permanent.send(email)).rejects.toBeInstanceOf(MailerError);
    await expect(
      new GmailApiMailer({ ...config, fetch: fakeFetch([400]).f }).send(email),
    ).rejects.toMatchObject({
      retryable: false,
    });
  });

  it('drops recipients outside the staging allowlist', async () => {
    const { f, calls } = fakeFetch([]);
    const r = await new GmailApiMailer({ ...config, fetch: f, allowlist: ['ok@example.test'] }).send(email);
    expect(r.providerMessageId).toBe('dropped-not-on-allowlist');
    expect(calls).toHaveLength(0);
  });
});
