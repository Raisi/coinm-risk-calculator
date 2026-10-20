/**
 * Form state transitions: raw inputs plus what the take-profit is derived from (a CRV or the typed TP).
 * Pure, no React.
 */

import { maxReachableCrv, tpOnTickForCrv, validLossPerUsd } from "./calc";
import { DEFAULT_INPUTS, type RawInputs } from "./evaluate";
import { formatDe, parseNumber, toPlainDecimal } from "./format";

/** Initial CRV target: TP is filled for it as soon as entry and stop allow. */
export const DEFAULT_CRV = 2;

/** Decimals of the Bitunix BTC price tick (0.1 USD); a TP derived from a CRV is rounded to it. */
export const TP_DECIMALS = 1;

/** Fields a TP derived from a CRV target is recomputed from. */
const TP_SOURCE_FIELDS: readonly (keyof RawInputs)[] = ["direction", "entry", "stop"];

/**
 * TP input (plain dot decimal on the price tick) whose CRV is `crv` for the raw entry/stop.
 * `null` when entry/stop do not parse, the stop is not usable, or no price reaches `crv`
 * (see `tpOnTickForCrv`).
 */
export function tpInputForCrv(inputs: Pick<RawInputs, "direction" | "entry" | "stop">, crv: number): string | null {
  const entry = parseNumber(inputs.entry);
  const stop = parseNumber(inputs.stop);
  if (entry === null || stop === null) return null;
  const tp = tpOnTickForCrv(inputs.direction, entry, stop, crv, TP_DECIMALS);
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
 * `TEXT_CRV_INVALID`; a long target at or above `maxReachableCrv` gives `crvUnreachableText`; a target
 * whose price rounds off the valid side of entry gives `TEXT_CRV_OFF_TICK`. Empty text and unusable
 * entry/stop (the field is disabled then) give no error.
 */
export function tpInputForCrvText(
  inputs: Pick<RawInputs, "direction" | "entry" | "stop">,
  text: string,
): CrvTextResult {
  if (text.trim() === "") return { error: null };
  const crv = parseNumber(text);
  if (crv === null || !(crv > 0)) return { error: TEXT_CRV_INVALID };
  const entry = parseNumber(inputs.entry);
  const stop = parseNumber(inputs.stop);
  if (entry === null || stop === null || validLossPerUsd(inputs.direction, entry, stop) === null) {
    return { error: null };
  }
  const max = maxReachableCrv(inputs.direction, entry, stop);
  if (max !== null && crv >= max) return { error: crvUnreachableText(max) };
  const tp = tpInputForCrv(inputs, crv);
  return tp === null ? { error: TEXT_CRV_OFF_TICK } : { tp };
}

/**
 * What TP is derived from: a CRV (`crv`), so entry/stop/direction changes recompute TP for it, or the
 * TP the user typed (`tp`), which stays while the CRV follows entry/stop/TP.
 */
export type TpTarget = { kind: "crv"; crv: number } | { kind: "tp" };

export interface FormState {
  inputs: RawInputs;
  target: TpTarget;
}

export const INITIAL_FORM_STATE: FormState = {
  inputs: DEFAULT_INPUTS,
  target: { kind: "crv", crv: DEFAULT_CRV },
};

/** `patch`: form field edits; `crv`: a CRV set by the slider or the CRV field. */
export type FormAction = { type: "patch"; patch: Partial<RawInputs> } | { type: "crv"; crv: number };

/**
 * - `patch` carrying `tp`: TP target, TP kept as given.
 * - other `patch`: merged; with a CRV target, a change to entry, stop or direction recomputes TP for it,
 *   or "" when it is not reachable. All other fields leave TP alone.
 * - `crv`: when reachable (see `tpInputForCrv`) it becomes the target and TP is set for it; otherwise
 *   the state is returned unchanged.
 */
export function formReducer(state: FormState, action: FormAction): FormState {
  if (action.type === "crv") {
    const tp = tpInputForCrv(state.inputs, action.crv);
    if (tp === null) return state;
    return { inputs: { ...state.inputs, tp }, target: { kind: "crv", crv: action.crv } };
  }
  const { patch } = action;
  const inputs = { ...state.inputs, ...patch };
  if (patch.tp !== undefined) return { inputs, target: { kind: "tp" } };
  const { target } = state;
  if (target.kind === "crv" && TP_SOURCE_FIELDS.some((field) => patch[field] !== undefined)) {
    inputs.tp = tpInputForCrv(inputs, target.crv) ?? "";
  }
  return { inputs, target };
}
