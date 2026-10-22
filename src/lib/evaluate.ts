/**
 * Raw form inputs -> validated numbers -> results, safety classification and warnings.
 * Pure, no React.
 */

import {
  approxPositionUsd,
  crvFromPrices,
  gainPerUsd,
  grossRisk,
  liquidationFactor,
  liquidationPrice,
  MAX_LEVERAGE,
  lossPerUsd,
  maxLeverageForFactor,
  maxReachableCrv,
  MIN_LEVERAGE,
  netRisk,
  positionSize,
  shortHasNoLiquidation,
  TP_DECIMALS,
  tpOnTickForCrv,
  validLossPerUsd,
  type AccountUnit,
  type CrvBasis,
  type Direction,
  type RiskMode,
} from "./calc";
import { formatDe, formatDeCompact, parseNumber, type JournalRow } from "./format";
import { ladderRows, partialPlan, type TakeProfits, type TpPart, type TpPlan } from "./tpPlan";

/** Form state; numeric fields are raw strings as typed by the user. */
export interface RawInputs {
  account: AccountUnit;
  /** Balance of a BTC account. */
  balance: string;
  /** Equity of a USDT account. */
  balanceUsdt: string;
  riskMode: RiskMode;
  riskPct: string;
  /** Fixed risk amount of a BTC account. */
  riskBtc: string;
  /** Fixed risk amount of a USDT account. */
  riskUsdt: string;
  riskLimitPct: string;
  direction: Direction;
  entry: string;
  stop: string;
  tp: string;
  crvBasis: CrvBasis;
  leverage: string;
  bufferPct: string;
  mmr: string;
  safetyFactor: string;
  nearFactor: string;
  panelLiq: string;
  tpPlan: TpPlan;
  tp1Crv: string;
  tp1Share: string;
  tp2Crv: string;
  tp2Share: string;
  tp3Crv: string;
  tp3Share: string;
}

export const DEFAULT_INPUTS: RawInputs = {
  account: "btc",
  balance: "",
  balanceUsdt: "",
  riskMode: "pct",
  riskPct: "5",
  riskBtc: "",
  riskUsdt: "",
  riskLimitPct: "10",
  direction: "long",
  entry: "",
  stop: "",
  tp: "",
  crvBasis: "btc",
  leverage: "10",
  bufferPct: "5",
  mmr: "0.004",
  safetyFactor: "2",
  nearFactor: "1.5",
  panelLiq: "",
  tpPlan: "ladder",
  tp1Crv: "1",
  tp1Share: "50",
  tp2Crv: "2",
  tp2Share: "30",
  tp3Crv: "3",
  tp3Share: "20",
};

export type NumericField = Exclude<keyof RawInputs, "account" | "riskMode" | "direction" | "crvBasis" | "tpPlan">;

/** Raw fields of the partial TPs TP1–TP3, in order. */
export const TP_PART_FIELDS = [
  { crv: "tp1Crv", share: "tp1Share" },
  { crv: "tp2Crv", share: "tp2Share" },
  { crv: "tp3Crv", share: "tp3Share" },
] as const satisfies readonly { crv: NumericField; share: NumericField }[];

export const FIELD_LABELS: Record<NumericField, string> = {
  balance: "Kontostand",
  balanceUsdt: "Kontostand",
  riskPct: "Risiko in %",
  riskBtc: "Risiko in BTC",
  riskUsdt: "Risiko in USDT",
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
  tp1Crv: "TP1 CRV",
  tp1Share: "TP1 Anteil",
  tp2Crv: "TP2 CRV",
  tp2Share: "TP2 Anteil",
  tp3Crv: "TP3 CRV",
  tp3Share: "TP3 Anteil",
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

export function tpSharesSumText(sum: number): string {
  return `Anteile der Teil-TPs ergeben ${formatDeCompact(sum, 2)} % – zusammen müssen es 100 % sein.`;
}

/** A partial TP's CRV has no TP on the price tick: above the basis bound `max`, or (`null`) by tick rounding. */
export function tpPartUnreachableText(label: string, max: number | null): string {
  return max === null
    ? `${label} nicht erreichbar – kein TP-Preis auf dem 0,1-USD-Tick.`
    : `${label} nicht erreichbar – max. ${formatDe(max, 2)} R bei diesem Stop.`;
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
    account: AccountUnit;
    direction: Direction;
    crvBasis: CrvBasis;
    /** In the account unit (BTC or USDT). */
    balance: number;
    entry: number;
    stop: number;
    tp: number | null;
    leverage: number;
    mmr: number;
    safetyFactor: number;
    nearFactor: number;
  };
  /** Risk budget before the buffer, in the account unit. */
  grossRisk: number;
  /** `riskLimitPct` of the balance, in the account unit. */
  riskLimit: number;
  /** BTC lost at the stop before the buffer. */
  grossRiskBtc: number;
  /** BTC lost at the stop (net of the buffer): the sizing risk. */
  riskBtc: number;
  riskPctEffective: number;
  stopDistancePct: number;
  positionUsd: number;
  positionBtc: number;
  marginBtc: number;
  /** Margin valued at the entry price. */
  marginUsdt: number;
  approxPositionUsd: number;
  effectiveLeverage: number;
  /** `riskBtc · stop`: USD value of the BTC lost, at the stop price (= net USDT risk of a USDT account). */
  lossAtStopUsdt: number;
  gainBtc: number | null;
  /** `gainBtc · tp`: USD value of the BTC gained, at the TP price. */
  gainAtTpUsdt: number | null;
  /** CRV of the TP in the active basis. */
  crv: number | null;
  takeProfits: TakeProfits;
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
  balanceUsdt: { test: (v) => v > 0, message: "muss größer als 0 sein." },
  riskPct: { test: (v) => v > 0, message: "muss größer als 0 sein." },
  riskBtc: { test: (v) => v > 0, message: "muss größer als 0 sein." },
  riskUsdt: { test: (v) => v > 0, message: "muss größer als 0 sein." },
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
  tp1Crv: { test: (v) => v > 0, message: "muss größer als 0 sein." },
  tp1Share: { test: (v) => v >= 0, message: "muss mindestens 0 sein." },
  tp2Crv: { test: (v) => v > 0, message: "muss größer als 0 sein." },
  tp2Share: { test: (v) => v >= 0, message: "muss mindestens 0 sein." },
  tp3Crv: { test: (v) => v > 0, message: "muss größer als 0 sein." },
  tp3Share: { test: (v) => v >= 0, message: "muss mindestens 0 sein." },
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

  const { account, direction, riskMode, crvBasis, tpPlan } = raw;
  const balance = read(account === "btc" ? "balance" : "balanceUsdt", true);
  const riskPct = riskMode === "pct" ? read("riskPct", true) : 0;
  const riskAmount = riskMode === "amount" ? read(account === "btc" ? "riskBtc" : "riskUsdt", true) : 0;
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

  // Partial TPs are only read for that plan; their TP prices are checked once entry and stop are usable.
  const parts: TpPart[] = [];
  if (tpPlan === "partial") {
    const prices =
      entry !== null && stop !== null && validLossPerUsd(direction, entry, stop) !== null ? { entry, stop } : null;
    let shareSum = 0;
    let sharesRead = 0;
    for (const fields of TP_PART_FIELDS) {
      const crv = read(fields.crv, true);
      const sharePct = read(fields.share, true);
      if (sharePct !== null) {
        shareSum += sharePct;
        sharesRead += 1;
      }
      if (crv === null || prices === null) continue;
      const partTp = tpOnTickForCrv(crvBasis, direction, prices.entry, prices.stop, crv, TP_DECIMALS);
      if (partTp === null) {
        const max = maxReachableCrv(crvBasis, direction, prices.entry, prices.stop);
        const message = tpPartUnreachableText(FIELD_LABELS[fields.crv], max !== null && crv >= max ? max : null);
        errors.push({ field: fields.crv, kind: "range", message });
      } else if (sharePct !== null) {
        parts.push({ crv, sharePct, tp: partTp });
      }
    }
    // Decimal shares such as 33,3 + 33,3 + 33,4 may miss 100 by float noise.
    if (sharesRead === TP_PART_FIELDS.length && Math.abs(shareSum - 100) > 1e-9) {
      errors.push({ field: "tp3Share", kind: "range", message: tpSharesSumText(shareSum) });
    }
  }

  if (
    errors.length > 0 ||
    balance === null ||
    riskPct === null ||
    riskAmount === null ||
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

  // Risk amounts are in the account unit. A USDT budget is what the position may lose at the stop, so in
  // BTC it is that amount at the stop price; the inverse sizing then gives the linear notional
  // N_usd = risk USDT · entry / |entry - stop|.
  const gross = grossRisk(riskMode, balance, riskPct, riskAmount);
  const net = netRisk(gross, bufferPct);
  const grossRiskBtc = account === "btc" ? gross : gross / stop;
  const riskBtc = account === "btc" ? net : net / stop;
  const size = positionSize(direction, riskBtc, entry, stop, leverage);
  let gainBtc: number | null = null;
  let gainAtTpUsdt: number | null = null;
  let crv: number | null = null;
  if (tp !== null) {
    gainBtc = size.usd * gainPerUsd(direction, entry, tp);
    gainAtTpUsdt = gainBtc * tp;
    crv = crvBasis === "btc" ? gainBtc / riskBtc : crvFromPrices("usd", direction, entry, stop, tp);
  }
  const lossAtStopUsdt = account === "usdt" ? net : riskBtc * stop;
  const marginUsdt = size.marginBtc * entry;
  const approxUsd = approxPositionUsd(riskBtc, entry, stop);
  // Position over balance in the account unit (≡ positionBtc / balance in BTC at entry for USDT).
  const effectiveLeverage = account === "btc" ? size.btc / balance : size.usd / balance;
  const riskLimit = (balance * riskLimitPct) / 100;
  const riskOverLimit = gross > riskLimit;

  // A stop extremely close to entry can make lossPerUsd 0 through float cancellation,
  // which would yield an infinite position; never present such numbers as a result.
  const sizing = [
    riskBtc,
    size.usd,
    size.btc,
    size.marginBtc,
    marginUsdt,
    approxUsd,
    effectiveLeverage,
    lossAtStopUsdt,
    gainBtc ?? 0,
    gainAtTpUsdt ?? 0,
    crv ?? 0,
  ];
  if (!(lossPerUsd(direction, entry, stop) > 0) || !(size.usd > 0) || !sizing.every(Number.isFinite)) {
    return { ok: false, errors: [{ field: "stop", kind: "calc", message: TEXT_SIZING_NOT_COMPUTABLE }] };
  }

  const trade = { basis: crvBasis, direction, entry, stop };
  const takeProfits: TakeProfits =
    tpPlan === "ladder"
      ? { plan: "ladder", rows: ladderRows(trade, size.usd) }
      : { plan: "partial", ...partialPlan(trade, size, riskBtc, parts) };

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
      inputs: { account, direction, crvBasis, balance, entry, stop, tp, leverage, mmr, safetyFactor, nearFactor },
      grossRisk: gross,
      riskLimit,
      grossRiskBtc,
      riskBtc,
      riskPctEffective: (gross / balance) * 100,
      stopDistancePct: (Math.abs(entry - stop) / entry) * 100,
      positionUsd: size.usd,
      positionBtc: size.btc,
      marginBtc: size.marginBtc,
      marginUsdt,
      approxPositionUsd: approxUsd,
      effectiveLeverage,
      lossAtStopUsdt,
      gainBtc,
      gainAtTpUsdt,
      crv,
      takeProfits,
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
