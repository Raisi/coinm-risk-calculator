/**
 * Current BTC Coin-M price from the public Binance futures ticker, fetched only when the user asks for it.
 * Binance Coin-M BTCUSD_PERP is the same contract type as Bitunix BTC Coin-M; the Bitunix REST API sends no
 * CORS header and cannot be called from this static site. The response is untrusted and strictly validated.
 * Pure, no React.
 */

import { TP_DECIMALS } from "./calc";
import { toPlainDecimal } from "./format";

/** Public ticker endpoint (CORS `*`, request weight 1). No key, no cookies. */
export const LIVE_PRICE_URL = "https://dapi.binance.com/dapi/v1/ticker/price?symbol=BTCUSD_PERP";

/** The only symbol a response may carry. */
export const LIVE_PRICE_SYMBOL = "BTCUSD_PERP";

/** Source named in the hint after a successful fetch. */
export const LIVE_PRICE_SOURCE = "Binance Coin-M BTCUSD_PERP";

/** A request still running after this many milliseconds is aborted and fails. */
export const LIVE_PRICE_TIMEOUT_MS = 8000;

/** Shown at the Entry field when the price could not be fetched or the response was rejected. */
export const TEXT_LIVE_PRICE_FAILED = "Kurs nicht abrufbar – bitte manuell eingeben.";

/** A validated ticker price. */
export interface LivePrice {
  /** Finite and > 0, in USD. */
  price: number;
  /** Exchange timestamp in ms since the epoch, or `null` if the response carried no usable one. */
  time: number | null;
}

/** Thrown by {@link fetchLivePrice} for a non-OK status, a body that is not JSON, or a rejected response. */
export class LivePriceError extends Error {
  override name = "LivePriceError";
}

/** Unsigned dot-decimal as Binance sends it ("81657.3"); no sign, exponent, grouping or whitespace. */
const PRICE_TEXT = /^\d+(\.\d+)?$/;

/** Largest timestamp a `Date` can represent. */
const MAX_DATE_MS = 8.64e15;

/**
 * Validates a parsed ticker response body.
 *
 * Accepts only an array whose first element with `symbol === "BTCUSD_PERP"` has a `price` string that is a
 * plain dot-decimal parsing to a finite number > 0. `time` is kept when it is a positive integer a `Date`
 * can represent, else `null`. Returns `null` for anything else (wrong shape, wrong symbol, price 0,
 * negative, non-numeric, non-finite or not a string).
 */
export function parseLivePrice(body: unknown): LivePrice | null {
  if (!Array.isArray(body)) return null;
  const ticker: unknown = body.find(
    (item: unknown) =>
      typeof item === "object" && item !== null && "symbol" in item && item.symbol === LIVE_PRICE_SYMBOL,
  );
  if (typeof ticker !== "object" || ticker === null || !("price" in ticker)) return null;
  if (typeof ticker.price !== "string" || !PRICE_TEXT.test(ticker.price)) return null;
  const price = Number(ticker.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const time = "time" in ticker ? ticker.time : undefined;
  const validTime = typeof time === "number" && Number.isInteger(time) && time > 0 && time <= MAX_DATE_MS;
  return { price, time: validTime ? time : null };
}

/** Entry text for a price: plain dot decimal, rounded down to the 0.1 USD tick ("81657.3"). */
export function livePriceEntry(price: number): string {
  return toPlainDecimal(price, TP_DECIMALS);
}

/**
 * Hint after a successful fetch, e.g. "Binance Coin-M BTCUSD_PERP · 10:42:05" (local time).
 * Uses the exchange time of `quote`, or `now` if the response had none.
 */
export function livePriceHint(quote: LivePrice, now: Date): string {
  const date = quote.time !== null ? new Date(quote.time) : now;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${LIVE_PRICE_SOURCE} · ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export interface FetchLivePriceOptions {
  /** Aborts the request; the promise then rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Fetch implementation (tests); defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Defaults to {@link LIVE_PRICE_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * Fetches the current BTCUSD_PERP price: exactly one GET to {@link LIVE_PRICE_URL} per call, with
 * `cache: "no-store"` and `credentials: "omit"`.
 *
 * Rejects with
 * - the reason of `signal` once it is aborted (also if the response arrives after the abort),
 * - a `DOMException` named `"TimeoutError"` after `timeoutMs`,
 * - a {@link LivePriceError} for a non-OK status, a body that is not JSON, or a response
 *   {@link parseLivePrice} rejects,
 * - or whatever `fetch` rejects with (e.g. a `TypeError` when offline or blocked).
 */
export async function fetchLivePrice({
  signal,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = LIVE_PRICE_TIMEOUT_MS,
}: FetchLivePriceOptions = {}): Promise<LivePrice> {
  signal?.throwIfAborted();
  // One signal for the caller's abort and the timeout. Every await races it, so an abort settles at once even if
  // the fetch ignores its signal, and is re-checked afterwards, so a response arriving after an abort is never
  // returned.
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException("Live price request timed out", "TimeoutError")),
    timeoutMs,
  );
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
  });
  try {
    const response = await Promise.race([
      fetchImpl(LIVE_PRICE_URL, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
        credentials: "omit",
      }),
      aborted,
    ]);
    controller.signal.throwIfAborted();
    if (!response.ok) throw new LivePriceError(`Unexpected HTTP status ${response.status}`);
    let body: unknown;
    try {
      body = await Promise.race([response.json(), aborted]);
    } catch {
      controller.signal.throwIfAborted();
      throw new LivePriceError("Response body is not JSON");
    }
    controller.signal.throwIfAborted();
    const quote = parseLivePrice(body);
    if (quote === null) throw new LivePriceError("Unexpected response");
    return quote;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}
