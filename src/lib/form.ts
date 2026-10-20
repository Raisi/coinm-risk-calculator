/**
 * Form state transitions: raw inputs plus who owns the take-profit field.
 * Pure, no React.
 */

import { maxReachableCrv, tpOnTickForCrv, validLossPerUsd } from "./calc";
import { DEFAULT_INPUTS, type RawInputs } from "./evaluate";
import { formatDe, parseNumber, toPlainDecimal } from "./format";

/** CRV the take-profit is filled for until the user sets TP themselves. */
export const DEFAULT_CRV = 2;

/** Decimals of the Bitunix BTC price tick (0.1 USD); a TP derived from a CRV is rounded to it. */
export const TP_DECIMALS = 1;

/** Fields the auto-filled TP is derived from. */
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
 * `tpAuto`: TP follows entry/stop/direction at `DEFAULT_CRV`. Becomes `false` for good once the user
 * sets TP or the CRV (typing, pasting, clearing, the CRV slider or the CRV field, even when the CRV is
 * not reachable and TP keeps its value).
 */
export interface FormState {
  inputs: RawInputs;
  tpAuto: boolean;
}

export const INITIAL_FORM_STATE: FormState = { inputs: DEFAULT_INPUTS, tpAuto: true };

/**
 * Merges a form patch. A patch carrying `tp` hands TP to the user and keeps that value. Otherwise, in
 * auto mode, a change to entry, stop or direction sets TP to the `DEFAULT_CRV` price, or "" when there
 * is none; all other fields leave TP alone.
 */
export function applyInputPatch(state: FormState, patch: Partial<RawInputs>): FormState {
  const inputs = { ...state.inputs, ...patch };
  if (patch.tp !== undefined) return { inputs, tpAuto: false };
  if (state.tpAuto && TP_SOURCE_FIELDS.some((field) => patch[field] !== undefined)) {
    inputs.tp = tpInputForCrv(inputs, DEFAULT_CRV) ?? "";
  }
  return { inputs, tpAuto: state.tpAuto };
}
