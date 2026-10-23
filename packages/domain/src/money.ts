import DecimalJs from 'decimal.js';

/**
 * Decimal configured for money (ADR-0006): precision 30, half-up rounding.
 * JavaScript `number` is never used for money.
 */
export const Decimal = DecimalJs.clone({ precision: 30, rounding: DecimalJs.ROUND_HALF_UP });
export type Decimal = InstanceType<typeof Decimal>;
export type DecimalValue = DecimalJs.Value;

/** Rounds to 2 decimal places, half-up (ADR-0006: rounding is per line). */
export function roundMoney(value: DecimalValue): Decimal {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Wire format for money amounts: a string with exactly 2 decimals (API-STANDARDS §3). */
export function toMoneyString(value: DecimalValue): string {
  return roundMoney(value).toFixed(2);
}

export function sumMoney(values: readonly DecimalValue[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0));
}
