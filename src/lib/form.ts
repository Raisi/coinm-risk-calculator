/**
 * Form state transitions: raw inputs, what the take-profit is derived from (a CRV or the typed TP) and the
 * Kontostand BTC ↔ USDT link (see `balanceLink.ts`).
 * Pure, no React.
 */

import { linkBalance, typedBalanceField, type BalanceField, type BalanceRate } from "./balanceLink";
import { maxReachableCrv, TP_DECIMALS, tpOnTickForCrv, validLossPerUsd } from "./calc";
import { DEFAULT_INPUTS, type RawInputs } from "./evaluate";
import { formatDe, parseNumber, toPlainDecimal } from "./format";

/** Initial CRV target: TP is filled for it as soon as entry and stop allow. */
export const DEFAULT_CRV = 2;

/** Raw inputs a TP for a CRV depends on. */
type CrvInputs = Pick<RawInputs, "crvBasis" | "direction" | "entry" | "stop">;

/** Fields a TP derived from a CRV target is recomputed from. */
const TP_SOURCE_FIELDS: readonly (keyof CrvInputs)[] = ["crvBasis", "direction", "entry", "stop"];

/**
 * TP input (plain dot decimal on the price tick) whose CRV in the active basis is `crv` for the raw
 * entry/stop. `null` when entry/stop do not parse, the stop is not usable, or no price reaches `crv`
 * (see `tpOnTickForCrv`).
 */
export function tpInputForCrv(inputs: CrvInputs, crv: number): string | null {
  const entry = parseNumber(inputs.entry);
  const stop = parseNumber(inputs.stop);
  if (entry === null || stop === null) return null;
  const tp = tpOnTickForCrv(inputs.crvBasis, inputs.direction, entry, stop, crv, TP_DECIMALS);
  return tp === null ? null : toPlainDecimal(tp, TP_DECIMALS);
}

export const TEXT_CRV_INVALID = "CRV muss größer als 0 sein.";
export const TEXT_CRV_OFF_TICK = "CRV nicht erreichbar – kein TP-Preis auf dem 0,1-USD-Tick.";

export function crvUnreachableText(max: number): string {
  return `CRV nicht erreichbar – max. ${formatDe(max, 2)} R bei diesem Stop.`;
}

/** Outcome of a typed CRV: the TP input for it, or the inline error (`null`: none, e.g. an empty draft). */
export type CrvTextResult = { tp: string } | { error: string | null };

/**
 * TP for a CRV typed as text (de or dot decimal). Unparseable or non-positive text gives
 * `TEXT_CRV_INVALID`; a target at or above `maxReachableCrv` of the active basis (long in BTC, short in
 * USD) gives `crvUnreachableText`; a target whose price rounds off the valid side of entry gives
 * `TEXT_CRV_OFF_TICK`. Empty text and unusable entry/stop (the field is disabled then) give no error.
 */
export function tpInputForCrvText(inputs: CrvInputs, text: string): CrvTextResult {
  if (text.trim() === "") return { error: null };
  const crv = parseNumber(text);
  if (crv === null || !(crv > 0)) return { error: TEXT_CRV_INVALID };
  const entry = parseNumber(inputs.entry);
  const stop = parseNumber(inputs.stop);
  if (entry === null || stop === null || validLossPerUsd(inputs.direction, entry, stop) === null) {
    return { error: null };
  }
  const max = maxReachableCrv(inputs.crvBasis, inputs.direction, entry, stop);
  if (max !== null && crv >= max) return { error: crvUnreachableText(max) };
  const tp = tpInputForCrv(inputs, crv);
  return tp === null ? { error: TEXT_CRV_OFF_TICK } : { tp };
}

/**
 * What TP is derived from: a CRV (`crv`), so entry/stop/direction/basis changes recompute TP for it, or
 * the TP the user typed (`tp`), which stays while the CRV follows entry/stop/TP/basis.
 */
export type TpTarget = { kind: "crv"; crv: number } | { kind: "tp" };

export interface FormState {
  inputs: RawInputs;
  target: TpTarget;
  /** Balance field the user typed in last; the other one is derived from it. `null` until one is typed. */
  balanceSource: BalanceField | null;
  /** Last fetched live price, the BTC ↔ USDT rate of the balance pair; `null` until one is fetched. */
  balanceRate: BalanceRate | null;
}

export const INITIAL_FORM_STATE: FormState = {
  inputs: DEFAULT_INPUTS,
  target: { kind: "crv", crv: DEFAULT_CRV },
  balanceSource: null,
  balanceRate: null,
};

/**
 * `patch`: form field edits; `crv`: a CRV set by the slider or the CRV field; `balanceRate`: a fetched live
 * price for the balance pair.
 */
export type FormAction =
  | { type: "patch"; patch: Partial<RawInputs> }
  | { type: "crv"; crv: number }
  | { type: "balanceRate"; rate: BalanceRate };

/**
 * - `patch` carrying `tp`: TP target, TP kept as given.
 * - other `patch`: merged; with a CRV target, a change to entry, stop, direction or CRV basis recomputes
 *   TP for it, or "" when it is not reachable. All other fields leave TP alone.
 * - `patch` carrying exactly one of `balance` / `balanceUsdt`: that field becomes the balance source, kept
 *   as given; with a rate, the other one is converted from it (see `convertBalance`). Without a rate both
 *   are independent. Other patches (e.g. `account`) leave both balances alone.
 * - `crv`: when reachable (see `tpInputForCrv`) it becomes the target and TP is set for it; otherwise
 *   the state is returned unchanged.
 * - `balanceRate`: becomes the rate; the field linked to the balance source is recomputed from it.
 */
export function formReducer(state: FormState, action: FormAction): FormState {
  if (action.type === "crv") {
    const tp = tpInputForCrv(state.inputs, action.crv);
    if (tp === null) return state;
    return { ...state, inputs: { ...state.inputs, tp }, target: { kind: "crv", crv: action.crv } };
  }
  if (action.type === "balanceRate") {
    const { balanceSource } = state;
    const inputs =
      balanceSource === null ? state.inputs : linkBalance(state.inputs, balanceSource, action.rate.price);
    return { ...state, inputs, balanceRate: action.rate };
  }
  const { patch } = action;
  const typedBalance = typedBalanceField(patch);
  const merged = { ...state.inputs, ...patch };
  const inputs =
    typedBalance !== null && state.balanceRate !== null
      ? linkBalance(merged, typedBalance, state.balanceRate.price)
      : merged;
  const balanceSource = typedBalance ?? state.balanceSource;
  if (patch.tp !== undefined) return { ...state, inputs, target: { kind: "tp" }, balanceSource };
  const { target } = state;
  if (target.kind === "crv" && TP_SOURCE_FIELDS.some((field) => patch[field] !== undefined)) {
    inputs.tp = tpInputForCrv(inputs, target.crv) ?? "";
  }
  return { ...state, inputs, target, balanceSource };
}
