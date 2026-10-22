import { useEffect, useRef, useState } from "react";
import { fetchLivePrice, livePriceEntry, livePriceHint } from "@/lib/livePrice";

export type LivePriceState = { kind: "idle" } | { kind: "loading" } | { kind: "done"; hint: string } | { kind: "failed" };

const IDLE: LivePriceState = { kind: "idle" };

/**
 * "Aktueller Kurs" for the Entry field. Requests only when `load` is called from a click, never on mount,
 * render or input. At most one request runs at a time; `cancel` (Entry typed) and unmount abort it, and an
 * aborted request neither calls `apply` nor changes the state.
 */
export function useLivePrice(apply: (entry: string) => void) {
  const [state, setState] = useState<LivePriceState>(IDLE);
  // Set synchronously in `load`, so a second click before the re-render with the disabled button starts nothing.
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  async function load() {
    if (inFlight.current !== null) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setState({ kind: "loading" });
    try {
      const quote = await fetchLivePrice({ signal: controller.signal });
      if (controller.signal.aborted) return;
      apply(livePriceEntry(quote.price));
      setState({ kind: "done", hint: livePriceHint(quote, new Date()) });
    } catch {
      // Timeouts, network and validation errors fail; a cancelled request ends silently.
      if (!controller.signal.aborted) setState({ kind: "failed" });
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }

  /** Aborts a running request and clears a shown hint or error; called when the user edits Entry. */
  function cancel() {
    inFlight.current?.abort();
    inFlight.current = null;
    setState((current) => (current.kind === "idle" ? current : IDLE));
  }

  return { state, load, cancel };
}
