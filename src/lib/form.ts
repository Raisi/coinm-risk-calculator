/**
 * Form state transitions: raw inputs plus who owns the take-profit field.
 * Pure, no React.
 */

import { tpOnTickForCrv } from "./calc";
import { DEFAULT_INPUTS, type RawInputs } from "./evaluate";
import { parseNumber, toPlainDecimal } from "./format";

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

/**
 * `tpAuto`: TP follows entry/stop/direction at `DEFAULT_CRV`. Becomes `false` for good once the user
 * sets TP (typing, pasting, clearing or the CRV slider).
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
