import { useEffect, useRef, useState } from "react";
import { fetchLivePrice, livePriceHint, type LivePrice } from "@/lib/livePrice";

/** Button a request was started from: "Aktueller Kurs" at Entry or "Kurs laden" at the Kontostand pair. */
export type LivePriceTarget = "entry" | "balance";

/** State of a button's request; a balance success shows the applied balance rate, so it returns to idle. */
export type LivePriceRequestState = { kind: "idle" } | { kind: "loading" } | { kind: "failed" };
/** The Entry button also shows a hint naming the source and time of the price it set. */
export type LivePriceEntryState = LivePriceRequestState | { kind: "done"; hint: string };

const IDLE: LivePriceRequestState = { kind: "idle" };
const LOADING: LivePriceRequestState = { kind: "loading" };
const FAILED: LivePriceRequestState = { kind: "failed" };
const ALL_IDLE: { entry: LivePriceEntryState; balance: LivePriceRequestState } = { entry: IDLE, balance: IDLE };

/**
 * The one live price of the app, for the Entry and the Kontostand buttons. Requests only when `load` is
 * called from a click, never on mount, render or input. At most one request runs at a time, whichever button
 * started it (`loading` is true meanwhile); `cancel` (Entry typed) and unmount abort it, and an aborted
 * request neither calls `apply` nor changes the state. A successful fetch clears a shown failure of the other
 * button, since a price is now loaded.
 */
export function useLivePrice(apply: (quote: LivePrice, target: LivePriceTarget, receivedAt: Date) => void) {
  const [state, setState] = useState(ALL_IDLE);
  // Set synchronously in `load`, so a second click before the re-render with the disabled buttons starts nothing.
  const inFlight = useRef<{ controller: AbortController; target: LivePriceTarget } | null>(null);

  useEffect(() => () => inFlight.current?.controller.abort(), []);

  async function load(target: LivePriceTarget) {
    if (inFlight.current !== null) return;
    const controller = new AbortController();
    inFlight.current = { controller, target };
    setState((current) => ({ ...current, [target]: LOADING }));
    try {
      const quote = await fetchLivePrice({ signal: controller.signal });
      if (controller.signal.aborted) return;
      const receivedAt = new Date();
      apply(quote, target, receivedAt);
      const done: LivePriceEntryState | null =
        target === "entry" ? { kind: "done", hint: livePriceHint(quote, receivedAt) } : null;
      setState((current) => ({
        entry: done ?? (current.entry.kind === "failed" ? IDLE : current.entry),
        balance: target === "balance" || current.balance.kind === "failed" ? IDLE : current.balance,
      }));
    } catch {
      // Timeouts, network and validation errors fail; a cancelled request ends silently.
      if (!controller.signal.aborted) setState((current) => ({ ...current, [target]: FAILED }));
    } finally {
      if (inFlight.current?.controller === controller) inFlight.current = null;
    }
  }

  /** Aborts a request started from `target` and clears its shown hint or error; called when the user edits Entry. */
  function cancel(target: LivePriceTarget) {
    if (inFlight.current?.target === target) {
      inFlight.current.controller.abort();
      inFlight.current = null;
    }
    setState((current) => (current[target].kind === "idle" ? current : { ...current, [target]: IDLE }));
  }

  const loading = state.entry.kind === "loading" || state.balance.kind === "loading";
  return { state, loading, load, cancel };
}
