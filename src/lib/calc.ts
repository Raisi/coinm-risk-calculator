/**
 * Pure math for Bitunix BTC Coin-M (inverse, BTC-margined) positions.
 * No React, no I/O. All prices in USD, all amounts in BTC unless named otherwise.
 */

export type Direction = "long" | "short";
/** `amount`: a fixed risk amount in the account unit (BTC or USDT). */
export type RiskMode = "pct" | "amount";
/** Unit of the account balance and the risk budget. */
export type AccountUnit = "btc" | "usdt";
/**
 * What a CRV measures: `btc` the gain in BTC per BTC risked (inverse contract), `usd` the linear price
 * distance `|tp - entry| / |entry - stop|` (chart / spreadsheet R).
 */
export type CrvBasis = "btc" | "usd";

export const MIN_LEVERAGE = 1;
export const MAX_LEVERAGE = 50;

/** Decimals of the Bitunix BTC price tick (0.1 USD); a TP derived from a CRV is rounded to it. */
export const TP_DECIMALS = 1;

/** Risk budget before fees/slippage buffer, in the account unit: % of balance or a fixed amount. */
export function grossRisk(mode: RiskMode, balance: number, riskPct: number, riskAmount: number): number {
  return mode === "pct" ? (balance * riskPct) / 100 : riskAmount;
}

/** Risk used for sizing after reserving `bufferPct` % for fees/slippage (same unit as `gross`). */
export function netRisk(gross: number, bufferPct: number): number {
  return gross * (1 - bufferPct / 100);
}

/** BTC lost per 1 USD of notional when the stop is hit. */
export function lossPerUsd(direction: Direction, entry: number, stop: number): number {
  return direction === "long" ? 1 / stop - 1 / entry : 1 / entry - 1 / stop;
}

/** BTC gained per 1 USD of notional when the take-profit is hit. */
export function gainPerUsd(direction: Direction, entry: number, tp: number): number {
  return direction === "long" ? 1 / entry - 1 / tp : 1 / tp - 1 / entry;
}

/**
 * `lossPerUsd` of a usable stop: positive finite prices, stop strictly on the loss side of entry and a
 * finite, non-zero loss (a stop extremely close to entry can cancel to 0). `null` otherwise.
 */
export function validLossPerUsd(direction: Direction, entry: number, stop: number): number | null {
  if (!(entry > 0) || !(stop > 0) || !Number.isFinite(entry) || !Number.isFinite(stop)) return null;
  const loss = lossPerUsd(direction, entry, stop);
  return loss > 0 && Number.isFinite(loss) ? loss : null;
}

/**
 * CRV from prices alone, independent of size, risk and buffer: `btc` basis `gainPerUsd / lossPerUsd`,
 * `usd` basis `|tp - entry| / |entry - stop|`.
 * `null` when the stop is not usable (see `validLossPerUsd`) or `tp` is not a finite price beyond entry.
 */
export function crvFromPrices(
  basis: CrvBasis,
  direction: Direction,
  entry: number,
  stop: number,
  tp: number,
): number | null {
  const loss = validLossPerUsd(direction, entry, stop);
  const beyondEntry = direction === "long" ? tp > entry : tp > 0 && tp < entry;
  if (loss === null || !Number.isFinite(tp) || !beyondEntry) return null;
  const crv =
    basis === "btc" ? gainPerUsd(direction, entry, tp) / loss : Math.abs(tp - entry) / Math.abs(entry - stop);
  return crv > 0 && Number.isFinite(crv) ? crv : null;
}

/**
 * Exclusive upper bound of the CRV a take-profit can reach, or `null` when there is none or the stop is not
 * usable (see `validLossPerUsd`).
 * - `btc` basis: a long gains at most 1/entry BTC per USD, so it needs `crv < stop / (entry - stop)`;
 *   a short has no bound.
 * - `usd` basis: a short's TP must stay above 0, so it needs `crv < entry / (stop - entry)`; a long has
 *   no bound.
 */
export function maxReachableCrv(basis: CrvBasis, direction: Direction, entry: number, stop: number): number | null {
  if (validLossPerUsd(direction, entry, stop) === null) return null;
  if (basis === "btc") return direction === "long" ? stop / (entry - stop) : null;
  return direction === "short" ? entry / (stop - entry) : null;
}

/**
 * Take-profit price whose CRV (see `crvFromPrices`) in `basis` equals `crv`.
 * Returns `null` when `crv` is not a finite positive number, the stop is not usable, or no finite price
 * beyond entry reaches the target (see `maxReachableCrv`). That bound is checked directly because near it
 * the TP formula cancels to a tiny float and would yield a huge bogus (or tiny) price.
 */
export function tpForCrv(
  basis: CrvBasis,
  direction: Direction,
  entry: number,
  stop: number,
  crv: number,
): number | null {
  if (!(crv > 0) || !Number.isFinite(crv)) return null;
  const loss = validLossPerUsd(direction, entry, stop);
  if (loss === null) return null;
  const max = maxReachableCrv(basis, direction, entry, stop);
  if (max !== null && crv >= max) return null;
  const tp =
    basis === "usd"
      ? entry + crv * (entry - stop)
      : 1 / (direction === "long" ? 1 / entry - crv * loss : 1 / entry + crv * loss);
  const beyondEntry = direction === "long" ? tp > entry : tp < entry;
  return Number.isFinite(tp) && tp > 0 && beyondEntry ? tp : null;
}

/**
 * `tpForCrv` rounded to the nearest price tick (`decimals` places, e.g. 1 for 0.1 USD), for a CRV slider.
 * Deterministic: the same target always gives the same price. With a stop only a few ticks from entry,
 * neighbouring targets can round to the same tick.
 * `null` when `tpForCrv` is `null` or the rounded price is not beyond entry.
 */
export function tpOnTickForCrv(
  basis: CrvBasis,
  direction: Direction,
  entry: number,
  stop: number,
  crv: number,
  decimals: number,
): number | null {
  const tp = tpForCrv(basis, direction, entry, stop, crv);
  if (tp === null) return null;
  // Integer tick count divided by the scale is the double closest to the decimal price, e.g. 108000.3.
  const scale = 10 ** decimals;
  const rounded = Math.round(tp * scale) / scale;
  const beyondEntry = direction === "long" ? rounded > entry : rounded > 0 && rounded < entry;
  return Number.isFinite(rounded) && beyondEntry ? rounded : null;
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
