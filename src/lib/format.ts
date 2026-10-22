/**
 * Parsing of user input, de-DE display formatting, exchange copy values and journal TSV.
 * Pure, no React.
 */

import type { Direction } from "./calc";

/** Decimal places for copy values; copies are always rounded DOWN to this step. */
export const COPY_DECIMALS = {
  /** Bitunix "By Qty - USD": whole USD. */
  positionUsd: 0,
  /** Bitunix "By Position Size - BTC": 0.0001 BTC. */
  positionBtc: 4,
  /** Bitunix "By Cost - BTC": 0.00000001 BTC (1 sat). */
  marginBtc: 8,
} as const;

const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/**
 * Parses German ("81.005,9") or dot-decimal ("81005.9") input.
 * If the string contains a comma, dots are thousands separators and the comma is the decimal point.
 * Returns `null` for empty or invalid input.
 */
export function parseNumber(input: string): number | null {
  let normalized = input.trim().replace(/\s+/g, "");
  if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(/,/g, ".");
  }
  if (!PLAIN_NUMBER.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * A number as an exact decimal: `units / 10^scale`, with `scale` ≥ 0.
 */
export interface ExactDecimal {
  units: bigint;
  scale: number;
}

const TEN = BigInt(10);

/** 10^`exponent` (`exponent` ≥ 0) as a BigInt. */
export function pow10(exponent: number): bigint {
  return TEN ** BigInt(exponent);
}

/**
 * Exact decimal of the shortest round-trip form of a finite `value` (`String(value)`), so binary noise
 * never enters decimal arithmetic on it: 0.3 -> 3 / 10, 5e-7 -> 5 / 10^7, 1e21 -> 10^21 / 1.
 */
export function exactDecimal(value: number): ExactDecimal {
  if (!Number.isFinite(value)) throw new RangeError(`Exact decimal needs a finite value, got ${value}`);
  // e.g. "1292.9", "5e-7", "1.5e-7", "1e+21"
  const [mantissa, exponent = "0"] = String(value).split("e");
  const [intPart, fracPart = ""] = mantissa.split(".");
  const units = BigInt(intPart + fracPart);
  const scale = fracPart.length - Number(exponent);
  return scale < 0 ? { units: units * pow10(-scale), scale: 0 } : { units, scale };
}

/**
 * Exchange copy value: rounded DOWN to `decimals` places, dot decimal, no grouping.
 *
 * Truncates the shortest round-trip decimal form of `value` (`String(value)`) instead of doing
 * float arithmetic, so a step value stays on its step (0.0154 -> "0.0154", 0.1 + 0.2 -> "0.3")
 * and the result never exceeds the number as displayed, at any magnitude.
 * Copy values are sizes, so only finite, non-negative values are accepted.
 */
export function toCopyValue(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Copy value must be finite and non-negative, got ${value}`);
  }
  // e.g. "1292.9", "5e-7", "1.5e-7", "1e+21"
  const [mantissa, exponent = "0"] = String(value).split("e");
  const [intPart, fracPart = ""] = mantissa.split(".");
  let digits = intPart + fracPart;
  let point = intPart.length + Number(exponent);
  if (point < 0) {
    digits = "0".repeat(-point) + digits;
    point = 0;
  }
  digits = digits.padEnd(point, "0");
  const whole = digits.slice(0, point).replace(/^0+(?=\d)/, "") || "0";
  if (decimals === 0) return whole;
  return `${whole}.${digits.slice(point).padEnd(decimals, "0").slice(0, decimals)}`;
}

/**
 * Copy value with trailing zeros dropped ("84707.1", "116265"): dot decimal, no grouping and never
 * exponential, so `parseNumber` accepts it at any magnitude.
 */
export function toPlainDecimal(value: number, decimals: number): string {
  const copy = toCopyValue(value, decimals);
  return copy.includes(".") ? copy.replace(/0+$/, "").replace(/\.$/, "") : copy;
}

/**
 * `units / 10^decimals` (`units` ≥ 0) in the `toPlainDecimal` format: dot decimal, no grouping, never
 * exponential, trailing zeros dropped, e.g. 1962963 at 2 -> "19629.63", 3000000 at 8 -> "0.03".
 */
export function unitsToPlainDecimal(units: bigint, decimals: number): string {
  const digits = units.toString().padStart(decimals + 1, "0");
  if (decimals === 0) return digits;
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`.replace(/\.?0+$/, "");
}

/** Copy value for the journal: same truncation, decimal comma, trailing zeros dropped. */
function copyValueDe(value: number, decimals: number): string {
  return toPlainDecimal(value, decimals).replace(".", ",");
}

const deFormatters = new Map<string, Intl.NumberFormat>();

function deFormatter(minDecimals: number, maxDecimals: number, grouping: boolean): Intl.NumberFormat {
  const key = `${minDecimals}:${maxDecimals}:${grouping}`;
  let formatter = deFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("de-DE", {
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: maxDecimals,
      useGrouping: grouping,
    });
    deFormatters.set(key, formatter);
  }
  return formatter;
}

/** de-DE display with thousands grouping and a fixed number of decimals. */
export function formatDe(value: number, decimals: number): string {
  return deFormatter(decimals, decimals, true).format(value);
}

/** de-DE display with up to `maxDecimals` decimals (trailing zeros dropped). */
export function formatDeCompact(value: number, maxDecimals: number): string {
  return deFormatter(0, maxDecimals, true).format(value);
}

/** de-DE decimal comma without thousands grouping (journal / spreadsheet paste). */
export function formatDePlain(value: number, maxDecimals: number): string {
  return deFormatter(0, maxDecimals, false).format(value);
}

export interface JournalRow {
  direction: Direction;
  entry: number;
  stop: number;
  tp: number | null;
  riskPct: number;
  riskBtc: number;
  positionUsd: number;
  positionBtc: number;
  leverage: number;
  marginBtc: number;
  /** Panel liquidation if entered, else computed; `Infinity` = no liquidation. */
  liqPrice: number;
  crv: number | null;
  compliant: boolean;
}

export const JOURNAL_COLUMNS = [
  "Datum/Zeit",
  "Instrument",
  "Richtung",
  "Entry",
  "Stop",
  "TP",
  "Risiko %",
  "Risiko BTC",
  "Positionswert USD",
  "Positionswert BTC",
  "Hebel",
  "Margin BTC",
  "Liquidationspreis",
  "CRV (R)",
  "Regelkonform",
] as const;

export const JOURNAL_INSTRUMENT = "BTCUSD Coin-M";

/** Local time as "YYYY-MM-DD HH:mm". */
export function formatLocalDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Header line + one data row, tab separated, de-DE decimal comma, no grouping. */
export function buildJournalTsv(row: JournalRow, now: Date): string {
  const cells = [
    formatLocalDateTime(now),
    JOURNAL_INSTRUMENT,
    row.direction === "long" ? "Long" : "Short",
    formatDePlain(row.entry, 8),
    formatDePlain(row.stop, 8),
    row.tp === null ? "" : formatDePlain(row.tp, 8),
    formatDePlain(row.riskPct, 2),
    formatDePlain(row.riskBtc, 8),
    copyValueDe(row.positionUsd, COPY_DECIMALS.positionUsd),
    copyValueDe(row.positionBtc, COPY_DECIMALS.positionBtc),
    String(row.leverage),
    copyValueDe(row.marginBtc, COPY_DECIMALS.marginBtc),
    Number.isFinite(row.liqPrice) ? formatDePlain(row.liqPrice, 2) : "",
    row.crv === null ? "" : formatDePlain(row.crv, 2),
    row.compliant ? "ja" : "nein",
  ];
  return `${JOURNAL_COLUMNS.join("\t")}\n${cells.join("\t")}`;
}
