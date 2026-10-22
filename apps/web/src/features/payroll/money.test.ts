import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sumMoney } from './money';

const paisa = fc.bigInt({ min: -99_999_999_999_99n, max: 99_999_999_999_99n });
const toMoney = (p: bigint) => {
  const abs = p < 0n ? -p : p;
  return `${p < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
};

describe('sumMoney', () => {
  it('adds decimal strings exactly', () => {
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
    expect(sumMoney(['66850.00', '1850.5', '-3000.00'])).toBe('65700.50');
    expect(sumMoney([])).toBe('0.00');
    expect(sumMoney(['abc', '12.345'])).toBe('0.00');
  });

  it('equals the integer-paisa sum for any amounts (property)', () => {
    fc.assert(
      fc.property(fc.array(paisa, { maxLength: 50 }), (values) => {
        const expected = values.reduce((a, b) => a + b, 0n);
        expect(sumMoney(values.map(toMoney))).toBe(toMoney(expected));
      }),
    );
  });

  it('is independent of order (property)', () => {
    fc.assert(
      fc.property(fc.array(paisa, { maxLength: 20 }), (values) => {
        const strings = values.map(toMoney);
        expect(sumMoney([...strings].reverse())).toBe(sumMoney(strings));
      }),
    );
  });
});
