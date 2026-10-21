/**
 * Take-profit plan: a ladder of TP prices at fixed CRV levels, or up to three partial TPs that each close a
 * share of the position. Pure, no React.
 */

import { gainPerUsd, tpOnTickForCrv, TP_DECIMALS, type CrvBasis, type Direction } from "./calc";
import { COPY_DECIMALS, toCopyValue } from "./format";

export type TpPlan = "ladder" | "partial";

/** CRV levels of the ladder, in the active CRV basis. */
export const LADDER_CRVS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** Trade the plan is built for: CRV basis and prices of a usable stop. */
export interface PlanTrade {
  basis: CrvBasis;
  direction: Direction;
  entry: number;
  stop: number;
}

/** Position the plan closes, as from `positionSize`. */
export interface PlanPosition {
  usd: number;
  btc: number;
}

/** What hitting a TP price yields for a notional, valued at the TP price. */
export interface TpOutcome {
  /** TP on the price tick. */
  tp: number;
  /** |tp - entry| / entry in %. */
  distancePct: number;
  gainBtc: number;
  /** `gainBtc · tp`: USD value of the BTC gain at the TP price. */
  gainUsdt: number;
}

export interface LadderRow {
  crv: number;
  /** `null`: no price on the tick reaches `crv` (basis bound or tick rounding). */
  outcome: TpOutcome | null;
}

/** A partial TP: its CRV, the share of the position it closes and its TP for `crv` on the price tick. */
export interface TpPart {
  crv: number;
  sharePct: number;
  tp: number;
}

export interface PartialRow extends TpOutcome {
  crv: number;
  sharePct: number;
  /** Exact quantity closed at this TP. */
  qtyBtc: number;
  qtyUsd: number;
  /**
   * Bitunix copy quantity in BTC, rounded down; the last part with a share gets the rest of the copyable
   * position, so all copy quantities add up to it. `null` for a 0 % share.
   */
  copyQtyBtc: string | null;
}

export interface PartialPlan {
  parts: PartialRow[];
  totalGainBtc: number;
  totalGainUsdt: number;
  /** Share-weighted CRV in the trade's basis: `btc` total gain BTC / risk BTC, `usd` Σ share · R of each TP. */
  weightedCrv: number;
}

export type TakeProfits = { plan: "ladder"; rows: LadderRow[] } | ({ plan: "partial" } & PartialPlan);

function tpOutcome(direction: Direction, entry: number, tp: number, notionalUsd: number): TpOutcome {
  const gainBtc = notionalUsd * gainPerUsd(direction, entry, tp);
  return { tp, distancePct: (Math.abs(tp - entry) / entry) * 100, gainBtc, gainUsdt: gainBtc * tp };
}

/** One row per `LADDER_CRVS` level with the TP on the tick and the gain of the whole position. */
export function ladderRows(trade: PlanTrade, positionUsd: number): LadderRow[] {
  const { basis, direction, entry, stop } = trade;
  return LADDER_CRVS.map((crv) => {
    const tp = tpOnTickForCrv(basis, direction, entry, stop, crv, TP_DECIMALS);
    return { crv, outcome: tp === null ? null : tpOutcome(direction, entry, tp, positionUsd) };
  });
}

/**
 * Quantities, gains and copy values of partial TPs whose shares add up to 100 %. `riskBtc` is the net BTC
 * lost at the stop (the sizing risk), used for the `btc` weighted CRV.
 */
export function partialPlan(
  trade: PlanTrade,
  position: PlanPosition,
  riskBtc: number,
  parts: readonly TpPart[],
): PartialPlan {
  const { basis, direction, entry, stop } = trade;
  const decimals = COPY_DECIMALS.positionBtc;
  // Copy-step counts in BigInt: at large positions they exceed Number.MAX_SAFE_INTEGER, and the copy
  // values must add up to the position copy exactly. `toCopyValue` gives exactly `decimals` places, so
  // dropping the point yields the step count. The remainder is clamped at 0, though every earlier copy
  // is rounded down from a share of less than the whole position.
  const toUnits = (copy: string) => BigInt(copy.replace(".", ""));
  const positionUnits = toUnits(toCopyValue(position.btc, decimals));
  const lastIndex = parts.findLastIndex((part) => part.sharePct > 0);
  let usedUnits = BigInt(0);

  const rows = parts.map((part, index): PartialRow => {
    // Fraction first: `position · sharePct` could overflow to Infinity for a huge (but finite) position.
    const qtyBtc = position.btc * (part.sharePct / 100);
    const qtyUsd = position.usd * (part.sharePct / 100);
    let copyQtyBtc: string | null = null;
    if (index === lastIndex) {
      const rest = positionUnits > usedUnits ? positionUnits - usedUnits : BigInt(0);
      const digits = rest.toString().padStart(decimals + 1, "0");
      copyQtyBtc = `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
    } else if (part.sharePct > 0) {
      copyQtyBtc = toCopyValue(qtyBtc, decimals);
      usedUnits += toUnits(copyQtyBtc);
    }
    return {
      ...tpOutcome(direction, entry, part.tp, qtyUsd),
      crv: part.crv,
      sharePct: part.sharePct,
      qtyBtc,
      qtyUsd,
      copyQtyBtc,
    };
  });

  const totalGainBtc = rows.reduce((sum, row) => sum + row.gainBtc, 0);
  const totalGainUsdt = rows.reduce((sum, row) => sum + row.gainUsdt, 0);
  const weightedCrv =
    basis === "btc"
      ? totalGainBtc / riskBtc
      : rows.reduce((sum, row) => sum + row.sharePct * Math.abs(row.tp - entry), 0) / (100 * Math.abs(entry - stop));
  return { parts: rows, totalGainBtc, totalGainUsdt, weightedCrv };
}
