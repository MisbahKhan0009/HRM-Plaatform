const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** HTML-escapes interpolated values; every dynamic value in a template goes through it. */
export const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

export interface Rendered {
  subject: string;
  text: string;
  html: string;
}

export interface Block {
  /** Paragraphs of plain text (escaped in HTML). */
  paragraphs: string[];
  /** Optional call to action. */
  action?: { label: string; url: string };
  /** Optional list (escaped). */
  list?: string[];
  footer?: string;
}

// Paper theme colours and Arial: many mail clients ignore dark-mode CSS (EMAIL.md §3, brand book).
const INK = '#0b0b0c';
const MUTED = '#5b5b62';
const LINE = '#e4e4e7';

/** One layout for every email: plain-text and HTML bodies carry the same content. */
export function layout(subject: string, block: Block): Rendered {
  const textParts = [...block.paragraphs];
  if (block.list?.length) textParts.push(block.list.map((l) => `- ${l}`).join('\n'));
  if (block.action) textParts.push(`${block.action.label}: ${block.action.url}`);
  if (block.footer) textParts.push(block.footer);
  textParts.push('Big-Matrix HRM');

  const p = (t: string) => `<p style="margin:0 0 16px;line-height:1.5">${esc(t)}</p>`;
  const html = [
    '<!doctype html><html><body style="margin:0;background:#ffffff">',
    `<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:${INK}">`,
    `<p style="margin:0 0 24px;font-weight:bold;letter-spacing:0.02em">Big-Matrix HRM</p>`,
    ...block.paragraphs.map(p),
    block.list?.length
      ? `<ul style="margin:0 0 16px;padding-left:20px;line-height:1.6">${block.list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
      : '',
    block.action
      ? `<p style="margin:24px 0"><a href="${esc(block.action.url)}" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold">${esc(block.action.label)}</a></p>`
      : '',
    block.footer
      ? `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${LINE};color:${MUTED};font-size:13px;line-height:1.5">${esc(block.footer)}</p>`
      : '',
    '</div></body></html>',
  ].join('');
  return { subject, text: textParts.join('\n\n'), html };
}
