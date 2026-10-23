import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM build script without types
import { buildTokensCss } from '../scripts/build-tokens.mjs';

const tokens = JSON.parse(
  readFileSync(resolve(__dirname, '../../../docs/02-brand/source/tokens.json'), 'utf8'),
);
const css: string = buildTokensCss(tokens);

function varIn(block: string, name: string): string {
  const m = new RegExp(`--${name}: (#[0-9a-f]{6})`).exec(block);
  if (!m?.[1]) throw new Error(`missing ${name}`);
  return m[1];
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const blocks = {
  ink: css.split('[data-theme="paper"]')[0] ?? '',
  paper: css.split('[data-theme="paper"]')[1] ?? '',
};

describe('generated tokens', () => {
  it('matches the committed tokens.css', () => {
    expect(readFileSync(resolve(__dirname, 'tokens.css'), 'utf8')).toBe(css);
  });

  for (const theme of ['ink', 'paper'] as const) {
    it(`meets WCAG AA text contrast in ${theme}`, () => {
      const b = blocks[theme];
      for (const fg of ['text', 'text-2', 'text-3', 'ok', 'bad', 'warn', 'link']) {
        expect(contrast(varIn(b, fg), varIn(b, 'ground')), `${fg} on ground`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(varIn(b, 'control-border'), varIn(b, 'surface'))).toBeGreaterThanOrEqual(3);
    });
  }

  it('uses Ink as the default theme', () => {
    expect(css).toContain(':root,\n[data-theme="ink"]');
  });
});
