/**
 * Raw form inputs -> validated numbers -> results, safety classification and warnings.
 * Pure, no React.
 */

import {
  approxPositionUsd,
  gainPerUsd,
  grossRiskBtc,
  liquidationFactor,
  liquidationPrice,
  MAX_LEVERAGE,
  lossPerUsd,
  maxLeverageForFactor,
  MIN_LEVERAGE,
  netRiskBtc,
  positionSize,
  shortHasNoLiquidation,
  type Direction,
  type RiskMode,
} from "./calc";
import { formatDe, formatDeCompact, parseNumber, type JournalRow } from "./format";

/** Form state; numeric fields are raw strings as typed by the user. */
export interface RawInputs {
  balance: string;
  riskMode: RiskMode;
  riskPct: string;
  riskBtc: string;
  riskLimitPct: string;
  direction: Direction;
  entry: string;
  stop: string;
  tp: string;
  leverage: string;
  bufferPct: string;
  mmr: string;
  safetyFactor: string;
  nearFactor: string;
  panelLiq: string;
}

export const DEFAULT_INPUTS: RawInputs = {
  balance: "0.00725346",
  riskMode: "pct",
  riskPct: "5",
  riskBtc: "",
  riskLimitPct: "10",
  direction: "long",
  entry: "",
  stop: "",
  tp: "",
  leverage: "10",
  bufferPct: "5",
  mmr: "0.004",
  safetyFactor: "2",
  nearFactor: "1.5",
  panelLiq: "",
};

export type NumericField = Exclude<keyof RawInputs, "riskMode" | "direction">;

export const FIELD_LABELS: Record<NumericField, string> = {
  balance: "Kontostand",
  riskPct: "Risiko in %",
  riskBtc: "Risiko in BTC",
  riskLimitPct: "Risiko-Limit in %",
  entry: "Entry",
  stop: "Stop",
  tp: "TP",
  leverage: "Hebel",
  bufferPct: "Puffer Gebühren/Slippage",
  mmr: "Maintenance-Margin-Rate",
  safetyFactor: "Sicherheitsfaktor",
  nearFactor: "Nah-Schwelle",
  panelLiq: "Est. Liq. Price (Bitunix-Panel)",
};

export type Status = "gruen" | "gelb" | "rot";

/** `calc`: inputs are individually valid but the sizing cannot be computed reliably. */
export type InputErrorKind = "missing" | "invalid" | "range" | "side" | "calc";

export interface InputError {
  field: NumericField;
  kind: InputErrorKind;
  message: string;
}

export const TEXT_STOP_WRONG_SIDE = "Stop liegt auf der falschen Seite des Entry";
export const TEXT_TP_WRONG_SIDE = "TP liegt auf der falschen Seite des Entry";
export const TEXT_LIQ_AT_OR_BEFORE_STOP =
  "Liquidation liegt vor oder auf dem Stop – der Stop greift nicht.";
export const TEXT_LIQ_NEAR_STOP =
  "Liquidation liegt nahe am Stop – ein Docht/Slippage kann vor dem Stop liquidieren.";
export const TEXT_RISK_OVER_LIMIT = "Risiko inkl. Gebühren/Slippage über dem Limit";
export const TEXT_SHORT_LIQ_NOTE =
  "konservative Näherung, nicht kalibriert – Bitunix-Panel ist maßgeblich";
export const TEXT_NO_LEVERAGE_SUFFICES = "auch 1x reicht nicht";
export const TEXT_SIZING_NOT_COMPUTABLE =
  "Stop-Abstand zu klein für eine Berechnung – Positionsgröße wäre unbegrenzt bzw. nicht bestimmbar.";
export const TEXT_LIQ_NOT_COMPUTABLE =
  "Liquidationspreis nicht berechenbar – Entry außerhalb des rechenbaren Bereichs.";

export function factorBelowSafetyText(factor: number, safetyFactor: number): string {
  return `Liq-Abstand unter Sicherheitsfaktor (${formatDe(factor, 2)} statt ${formatDeCompact(safetyFactor, 2)}).`;
}

/** Green carries no text; yellow/red carry the user-facing warning. */
export type LiqClassification =
  | { status: "gruen"; text: null }
  | { status: Exclude<Status, "gruen">; text: string };

/** Traffic light for a signed liquidation factor (see `liquidationFactor`). */
export function classifyFactor(
  factor: number,
  nearFactor: number,
  safetyFactor: number,
): LiqClassification {
  if (factor <= 1) return { status: "rot", text: TEXT_LIQ_AT_OR_BEFORE_STOP };
  if (factor < nearFactor) return { status: "rot", text: TEXT_LIQ_NEAR_STOP };
  if (factor < safetyFactor) return { status: "gelb", text: factorBelowSafetyText(factor, safetyFactor) };
  return { status: "gruen", text: null };
}

const STATUS_RANK: Record<Status, number> = { gruen: 0, gelb: 1, rot: 2 };

export function worstStatus(statuses: readonly Status[]): Status {
  return statuses.reduce<Status>((worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst), "gruen");
}

export type LiqCheck = LiqClassification & {
  price: number;
  /** |entry - liq| / entry in %; `null` when there is no liquidation. */
  distancePct: number | null;
  factor: number;
};

export type WarningSource = "liq" | "panelLiq" | "risk";

export interface Warning {
  source: WarningSource;
  status: Exclude<Status, "gruen">;
  text: string;
}

export interface Evaluation {
  inputs: {
    direction: Direction;
    balance: number;
    entry: number;
    stop: number;
    tp: number | null;
    leverage: number;
    mmr: number;
    safetyFactor: number;
    nearFactor: number;
  };
  grossRiskBtc: number;
  riskBtc: number;
  riskPctEffective: number;
  riskLimitBtc: number;
  stopDistancePct: number;
  positionUsd: number;
  positionBtc: number;
  marginBtc: number;
  approxPositionUsd: number;
  effectiveLeverage: number;
  gainBtc: number | null;
  crv: number | null;
  liq: LiqCheck;
  panelLiq: LiqCheck | null;
  /** Leverage suggestion for a non-green computed liquidation; `null` when green. */
  suggestion: { maxLeverage: number | null; text: string } | null;
  riskOverLimit: boolean;
  warnings: Warning[];
  status: Status;
  /** No error and nothing red (yellow is compliant). */
  compliant: boolean;
}

export type EvaluationResult =
  | { ok: true; value: Evaluation }
  | { ok: false; errors: InputError[] };

type Range = { test: (v: number) => boolean; message: string };

const RANGES: Record<NumericField, Range> = {
  balance: { test: (v) => v > 0, message: "muss größer als 0 sein." },
  riskPct: { test: (v) => v > 0, message: "muss größer als 0 sein." },
  riskBtc: { test: (v) => v > 0, message: "muss größer als 0 sein." },
  riskLimitPct: { test: (v) => v > 0, message: "muss größer als 0 sein." },
  entry: { test: (v) => v > 0, message: "muss größer als 0 sein." },
  stop: { test: (v) => v > 0, message: "muss größer als 0 sein." },
  tp: { test: (v) => v > 0, message: "muss größer als 0 sein." },
  leverage: {
    test: (v) => Number.isInteger(v) && v >= MIN_LEVERAGE && v <= MAX_LEVERAGE,
    message: `muss eine ganze Zahl von ${MIN_LEVERAGE} bis ${MAX_LEVERAGE} sein.`,
  },
  bufferPct: { test: (v) => v >= 0 && v < 100, message: "muss mindestens 0 und unter 100 sein." },
  mmr: { test: (v) => v >= 0 && v < 0.5, message: "muss mindestens 0 und unter 0,5 sein." },
  safetyFactor: { test: (v) => v > 1, message: "muss größer als 1 sein." },
  nearFactor: { test: (v) => v >= 1, message: "muss mindestens 1 sein." },
  panelLiq: { test: (v) => v > 0, message: "muss größer als 0 sein." },
};

function checkLiq(
  direction: Direction,
  entry: number,
  stop: number,
  price: number,
  nearFactor: number,
  safetyFactor: number,
): LiqCheck {
  const factor = liquidationFactor(direction, entry, stop, price);
  return {
    ...classifyFactor(factor, nearFactor, safetyFactor),
    price,
    distancePct: Number.isFinite(price) ? (Math.abs(entry - price) / entry) * 100 : null,
    factor,
  };
}

export function evaluate(raw: RawInputs): EvaluationResult {
  const errors: InputError[] = [];
  const read = (field: NumericField, required: boolean): number | null => {
    const label = FIELD_LABELS[field];
    if (raw[field].trim() === "") {
      if (required) errors.push({ field, kind: "missing", message: `${label} fehlt.` });
      return null;
    }
    const value = parseNumber(raw[field]);
    if (value === null) {
      errors.push({ field, kind: "invalid", message: `${label} ist keine gültige Zahl.` });
      return null;
    }
    if (!RANGES[field].test(value)) {
      errors.push({ field, kind: "range", message: `${label} ${RANGES[field].message}` });
      return null;
    }
    return value;
  };

  const { direction, riskMode } = raw;
  const balance = read("balance", true);
  const riskPct = riskMode === "pct" ? read("riskPct", true) : 0;
  const riskBtcInput = riskMode === "btc" ? read("riskBtc", true) : 0;
  const riskLimitPct = read("riskLimitPct", true);
  const entry = read("entry", true);
  const stop = read("stop", true);
  const tp = read("tp", false);
  const leverage = read("leverage", true);
  const bufferPct = read("bufferPct", true);
  const mmr = read("mmr", true);
  const safetyFactor = read("safetyFactor", true);
  const nearFactor = read("nearFactor", true);
  const panelLiqPrice = read("panelLiq", false);

  if (nearFactor !== null && safetyFactor !== null && nearFactor > safetyFactor) {
    errors.push({
      field: "nearFactor",
      kind: "range",
      message: `${FIELD_LABELS.nearFactor} darf nicht größer als der ${FIELD_LABELS.safetyFactor} sein.`,
    });
  }
  if (entry !== null && stop !== null) {
    const stopWrong = direction === "long" ? stop >= entry : stop <= entry;
    if (stopWrong) errors.push({ field: "stop", kind: "side", message: TEXT_STOP_WRONG_SIDE });
  }
  if (entry !== null && tp !== null) {
    const tpWrong = direction === "long" ? tp <= entry : tp >= entry;
    if (tpWrong) errors.push({ field: "tp", kind: "side", message: TEXT_TP_WRONG_SIDE });
  }

  if (
    errors.length > 0 ||
    balance === null ||
    riskPct === null ||
    riskBtcInput === null ||
    riskLimitPct === null ||
    entry === null ||
    stop === null ||
    leverage === null ||
    bufferPct === null ||
    mmr === null ||
    safetyFactor === null ||
    nearFactor === null
  ) {
    return { ok: false, errors };
  }

  const gross = grossRiskBtc(riskMode, balance, riskPct, riskBtcInput);
  const riskBtc = netRiskBtc(gross, bufferPct);
  const size = positionSize(direction, riskBtc, entry, stop, leverage);
  const gainBtc = tp === null ? null : size.usd * gainPerUsd(direction, entry, tp);
  const crv = gainBtc === null ? null : gainBtc / riskBtc;
  const approxUsd = approxPositionUsd(riskBtc, entry, stop);
  const effectiveLeverage = size.btc / balance;
  const riskLimitBtc = (balance * riskLimitPct) / 100;
  const riskOverLimit = gross > riskLimitBtc;

  // A stop extremely close to entry can make lossPerUsd 0 through float cancellation,
  // which would yield an infinite position; never present such numbers as a result.
  const sizing = [size.usd, size.btc, size.marginBtc, approxUsd, effectiveLeverage, gainBtc ?? 0, crv ?? 0];
  if (!(lossPerUsd(direction, entry, stop) > 0) || !(size.usd > 0) || !sizing.every(Number.isFinite)) {
    return { ok: false, errors: [{ field: "stop", kind: "calc", message: TEXT_SIZING_NOT_COMPUTABLE }] };
  }

  // Infinity is only legitimate for a short that cannot be liquidated; any other
  // non-finite liquidation is an arithmetic failure and must not read as "safe".
  const liqPrice = liquidationPrice(direction, entry, leverage, mmr);
  if (!Number.isFinite(liqPrice) && !(direction === "short" && shortHasNoLiquidation(leverage, mmr))) {
    return { ok: false, errors: [{ field: "entry", kind: "calc", message: TEXT_LIQ_NOT_COMPUTABLE }] };
  }

  const liq = checkLiq(direction, entry, stop, liqPrice, nearFactor, safetyFactor);
  const panelLiq =
    panelLiqPrice === null
      ? null
      : checkLiq(direction, entry, stop, panelLiqPrice, nearFactor, safetyFactor);

  let suggestion: Evaluation["suggestion"] = null;
  if (liq.status !== "gruen") {
    const maxLeverage = maxLeverageForFactor(entry, stop, safetyFactor, mmr, direction);
    suggestion = {
      maxLeverage,
      text: maxLeverage === null ? `Vorschlag: ${TEXT_NO_LEVERAGE_SUFFICES}` : `Vorschlag: max. ${maxLeverage}x Hebel`,
    };
  }

  const warnings: Warning[] = [];
  if (liq.status !== "gruen") warnings.push({ source: "liq", status: liq.status, text: liq.text });
  if (panelLiq !== null && panelLiq.status !== "gruen") {
    warnings.push({ source: "panelLiq", status: panelLiq.status, text: panelLiq.text });
  }
  if (riskOverLimit) warnings.push({ source: "risk", status: "gelb", text: TEXT_RISK_OVER_LIMIT });

  const status = worstStatus(warnings.map((w) => w.status));

  return {
    ok: true,
    value: {
      inputs: { direction, balance, entry, stop, tp, leverage, mmr, safetyFactor, nearFactor },
      grossRiskBtc: gross,
      riskBtc,
      riskPctEffective: (gross / balance) * 100,
      riskLimitBtc,
      stopDistancePct: (Math.abs(entry - stop) / entry) * 100,
      positionUsd: size.usd,
      positionBtc: size.btc,
      marginBtc: size.marginBtc,
      approxPositionUsd: approxUsd,
      effectiveLeverage,
      gainBtc,
      crv,
      liq,
      panelLiq,
      suggestion,
      riskOverLimit,
      warnings,
      status,
      compliant: status !== "rot",
    },
  };
}

/** Journal row for a successful evaluation; the Bitunix panel liquidation wins over the computed one. */
export function toJournalRow(e: Evaluation): JournalRow {
  return {
    direction: e.inputs.direction,
    entry: e.inputs.entry,
    stop: e.inputs.stop,
    tp: e.inputs.tp,
    riskPct: e.riskPctEffective,
    riskBtc: e.grossRiskBtc,
    positionUsd: e.positionUsd,
    positionBtc: e.positionBtc,
    leverage: e.inputs.leverage,
    marginBtc: e.marginBtc,
    liqPrice: e.panelLiq?.price ?? e.liq.price,
    crv: e.crv,
    compliant: e.compliant,
  };
}
