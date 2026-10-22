/**
 * Kontostand pair: the BTC balance and the USDT balance linked through the last fetched live price.
 * The field the user typed in last is the source and is never rewritten; the other one is derived from it.
 * Pure, no React.
 */

import type { RawInputs } from "./evaluate";
import { exactDecimal, formatDeCompact, parseNumber, pow10, unitsToPlainDecimal } from "./format";
import { livePriceHint, type LivePrice } from "./livePrice";

/** The two balance inputs: BTC (`balance`) and USDT (`balanceUsdt`). */
export type BalanceField = "balance" | "balanceUsdt";

/**
 * Decimal places of a derived balance: 1 sat for BTC, cents for USDT. Derived values are rounded DOWN
 * (truncated) to this step, exactly in decimal like the copy values (see `toCopyValue`).
 */
export const BALANCE_DECIMALS: Readonly<Record<BalanceField, number>> = { balance: 8, balanceUsdt: 2 };

/** Shown at the Kontostand pair while no live price has been fetched. */
export const TEXT_BALANCE_RATE_MISSING = "Kurs laden, um BTC und USDT umzurechnen.";

/** Shown at the Kontostand pair when "Kurs laden" failed; both balances keep their values. */
export const TEXT_BALANCE_RATE_FAILED = "Kurs nicht abrufbar – Kontostände unverändert.";

/** Conversion rate of the pair: a live price in USDT per BTC and the time it was quoted (ms since the epoch). */
export interface BalanceRate {
  price: number;
  time: number;
}

/** Rate for a fetched quote; a quote without exchange time is dated `receivedAt`. */
export function balanceRate(quote: LivePrice, receivedAt: Date): BalanceRate {
  return { price: quote.price, time: quote.time ?? receivedAt.getTime() };
}

/** Hint for the pair, e.g. "1 BTC = 81.774,3 USDT · Binance Coin-M BTCUSD_PERP · 11:55:08" (local time). */
export function balanceRateHint(rate: BalanceRate): string {
  return `1 BTC = ${formatDeCompact(rate.price, 2)} USDT · ${livePriceHint(rate, new Date(rate.time))}`;
}

/**
 * The balance field a patch types into, or `null` when it carries neither or both (then nothing is linked).
 */
export function typedBalanceField(patch: Partial<RawInputs>): BalanceField | null {
  const btc = patch.balance !== undefined;
  const usdt = patch.balanceUsdt !== undefined;
  if (btc === usdt) return null;
  return btc ? "balance" : "balanceUsdt";
}

/**
 * Text for the field linked to `from`, converted from `text` (de or dot decimal) at `price` USDT per BTC:
 * BTC × price rounded DOWN to 2 decimals, or USDT ÷ price rounded DOWN to 8 decimals, as a plain dot
 * decimal with trailing zeros dropped (the `toPlainDecimal` format).
 *
 * The truncation is exact: the parsed value and the price are taken as the exact decimals of their
 * shortest round-trip forms (`exactDecimal`, 0.3 × 65432.1 = 19629.63 exactly, not the float
 * 19629.629999999997) and multiplied or divided in BigInt, so an exact step result stays on its step
 * while a result genuinely below it (19629.629) still drops to the step below (19629.62).
 *
 * "" when `text` is empty, unparseable or ≤ 0, when `price` is not > 0 or not finite, when the result
 * rounds down to 0, or when it lies beyond the number range (it would parse back as Infinity) — never
 * "NaN", "Infinity", "0" or exponential notation.
 */
export function convertBalance(from: BalanceField, text: string, price: number): string {
  const value = parseNumber(text);
  if (value === null || !(value > 0) || !(price > 0) || !Number.isFinite(price)) return "";
  const source = exactDecimal(value);
  const rate = exactDecimal(price);
  const decimals = from === "balance" ? BALANCE_DECIMALS.balanceUsdt : BALANCE_DECIMALS.balance;
  // Result × 10^decimals as an exact fraction; BigInt division truncates, i.e. floors the positive quotient.
  const [numerator, denominator] =
    from === "balance"
      ? [source.units * rate.units * pow10(decimals), pow10(source.scale + rate.scale)]
      : [source.units * pow10(rate.scale + decimals), rate.units * pow10(source.scale)];
  const units = numerator / denominator;
  if (units === BigInt(0)) return "";
  const result = unitsToPlainDecimal(units, decimals);
  return Number.isFinite(Number(result)) ? result : "";
}

/** `inputs` with the field linked to `source` recomputed from `source` at `price`; `source` is kept as is. */
export function linkBalance<T extends Pick<RawInputs, BalanceField>>(
  inputs: T,
  source: BalanceField,
  price: number,
): T {
  const linked: BalanceField = source === "balance" ? "balanceUsdt" : "balance";
  return { ...inputs, [linked]: convertBalance(source, inputs[source], price) };
}
