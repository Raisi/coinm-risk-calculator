/**
 * Pure math for Bitunix BTC Coin-M (inverse, BTC-margined) positions.
 * No React, no I/O. All prices in USD, all amounts in BTC unless named otherwise.
 */

export type Direction = "long" | "short";
export type RiskMode = "pct" | "btc";

export const MIN_LEVERAGE = 1;
export const MAX_LEVERAGE = 50;

/** Risk budget before fees/slippage buffer: % of balance or a fixed BTC amount. */
export function grossRiskBtc(
  mode: RiskMode,
  balanceBtc: number,
  riskPct: number,
  riskBtcInput: number,
): number {
  return mode === "pct" ? (balanceBtc * riskPct) / 100 : riskBtcInput;
}

/** Risk used for sizing after reserving `bufferPct` % for fees/slippage. */
export function netRiskBtc(grossRisk: number, bufferPct: number): number {
  return grossRisk * (1 - bufferPct / 100);
}

/** BTC lost per 1 USD of notional when the stop is hit. */
export function lossPerUsd(direction: Direction, entry: number, stop: number): number {
  return direction === "long" ? 1 / stop - 1 / entry : 1 / entry - 1 / stop;
}

/** BTC gained per 1 USD of notional when the take-profit is hit. */
export function gainPerUsd(direction: Direction, entry: number, tp: number): number {
  return direction === "long" ? 1 / entry - 1 / tp : 1 / tp - 1 / entry;
}

export interface PositionSize {
  /** Notional in USD (N_usd). */
  usd: number;
  /** Notional in BTC at entry (N_btc). */
  btc: number;
  /** Isolated margin in BTC at the given leverage. */
  marginBtc: number;
}

export function positionSize(
  direction: Direction,
  riskBtc: number,
  entry: number,
  stop: number,
  leverage: number,
): PositionSize {
  const usd = riskBtc / lossPerUsd(direction, entry, stop);
  const btc = usd / entry;
  return { usd, btc, marginBtc: btc / leverage };
}

/** Linear control approximation of the notional ("Näherung zur Kontrolle"). */
export function approxPositionUsd(riskBtc: number, entry: number, stop: number): number {
  const riskUsd = riskBtc * entry;
  return riskUsd / (Math.abs(entry - stop) / entry);
}

// `entry * (leverage / denominator)` instead of `(entry * leverage) / denominator`:
// the product could overflow to Infinity for huge (but finite) prices.
export function liquidationPriceLong(entry: number, leverage: number, mmr: number): number {
  return entry * (leverage / (leverage + 1 - leverage * mmr));
}

/** A short never gets liquidated when the denominator of the short formula is <= 0 (e.g. 1x with m = 0). */
export function shortHasNoLiquidation(leverage: number, mmr: number): boolean {
  return leverage - 1 + leverage * mmr <= 0;
}

/** Returns `Infinity` when no liquidation is reachable (see `shortHasNoLiquidation`). */
export function liquidationPriceShort(entry: number, leverage: number, mmr: number): number {
  if (shortHasNoLiquidation(leverage, mmr)) return Infinity;
  return entry * (leverage / (leverage - 1 + leverage * mmr));
}

export function liquidationPrice(
  direction: Direction,
  entry: number,
  leverage: number,
  mmr: number,
): number {
  return direction === "long"
    ? liquidationPriceLong(entry, leverage, mmr)
    : liquidationPriceShort(entry, leverage, mmr);
}

/**
 * Signed distance of the liquidation from entry, in multiples of the stop distance.
 * > 1 means the liquidation lies beyond the stop. Infinite liquidation -> Infinity.
 */
export function liquidationFactor(
  direction: Direction,
  entry: number,
  stop: number,
  liq: number,
): number {
  if (!Number.isFinite(liq)) return Infinity;
  return direction === "long" ? (entry - liq) / (entry - stop) : (liq - entry) / (stop - entry);
}

/**
 * Highest integer leverage whose liquidation lies at least `k` stop distances from entry.
 * Returns `null` when even 1x is not enough.
 */
export function maxLeverageForFactor(
  entry: number,
  stop: number,
  k: number,
  mmr: number,
  direction: Direction,
): number | null {
  // Prices relative to entry (entry = 1) so huge finite prices cannot overflow.
  const stopRel = stop / entry;
  let targetLiq: number;
  let denominator: number;
  if (direction === "long") {
    targetLiq = 1 - k * (1 - stopRel);
    if (targetLiq <= 0) return null;
    denominator = 1 - targetLiq * (1 - mmr);
  } else {
    targetLiq = 1 + k * (stopRel - 1);
    denominator = targetLiq * (1 + mmr) - 1;
  }
  // Float rounding can put the closed form just below an exact integer boundary (100/95, k=2, m=0 -> 8.999…),
  // so start one above and step down until the classification itself (liquidationFactor) accepts the leverage.
  // A non-finite liquidation only counts as safe for a short that genuinely cannot be liquidated, never on overflow.
  const isSafe = (lev: number): boolean => {
    const liq = liquidationPrice(direction, entry, lev, mmr);
    return Number.isFinite(liq)
      ? liquidationFactor(direction, entry, stop, liq) >= k
      : direction === "short" && shortHasNoLiquidation(lev, mmr);
  };
  const estimate = denominator > 0 ? Math.floor(targetLiq / denominator) + 1 : NaN;
  let leverage = Number.isFinite(estimate) ? Math.min(estimate, MAX_LEVERAGE) : MAX_LEVERAGE;
  while (leverage >= MIN_LEVERAGE && !isSafe(leverage)) leverage--;
  return leverage >= MIN_LEVERAGE ? leverage : null;
}
