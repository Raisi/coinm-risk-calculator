"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { EvaluationResult, Status, WarningSource } from "@/lib/evaluate";
import { formatDeCompact } from "@/lib/format";
import { MOTION, toneColor, useReducedMotion, type Tone } from "./motion";

const HEADLINE: Record<Status, string> = {
  gruen: "Grün – regelkonform",
  gelb: "Gelb – regelkonform, mit Hinweis",
  rot: "Rot – nicht regelkonform",
};

const SOURCE_LABEL: Record<WarningSource, string | null> = {
  liq: "Berechnete Liquidation",
  panelLiq: "Liquidation laut Bitunix-Panel",
  risk: null,
};

export function Warnings({ result }: { result: EvaluationResult }) {
  const lamp = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();

  const onlyMissing = !result.ok && result.errors.every((e) => e.kind === "missing");
  const tone: Tone = result.ok ? result.value.status : onlyMissing ? "neutral" : "rot";

  useGSAP(
    () => {
      gsap.to(lamp.current, {
        backgroundColor: toneColor(tone),
        ...MOTION,
        duration: reduced.current ? 0 : MOTION.duration,
        overwrite: "auto",
      });
    },
    { dependencies: [tone] },
  );

  return (
    <section className="signal" data-tone={tone} aria-labelledby="signal-title">
      <div role="status" aria-live="polite" aria-atomic="true">
        <h2 id="signal-title" className="signal__title">
          <span className="signal__lamp" ref={lamp} aria-hidden="true" />
          {result.ok ? HEADLINE[result.value.status] : onlyMissing ? "Eingaben fehlen" : "Eingaben prüfen"}
        </h2>
      </div>

      {!result.ok && (
        <ul className="signal__list">
          {result.errors.map((error) => (
            <li key={`${error.field}-${error.kind}`} data-kind={error.kind}>
              {error.message}
            </li>
          ))}
        </ul>
      )}

      {result.ok && result.value.warnings.length > 0 && (
        <ul className="signal__list">
          {result.value.warnings.map((warning) => (
            <li key={warning.source} data-status={warning.status}>
              {SOURCE_LABEL[warning.source] !== null && (
                <span className="signal__source">{SOURCE_LABEL[warning.source]}: </span>
              )}
              {warning.text}
            </li>
          ))}
        </ul>
      )}

      {result.ok && result.value.suggestion !== null && (
        <p className="signal__suggestion">{result.value.suggestion.text}</p>
      )}

      {result.ok && result.value.warnings.length === 0 && (
        <p className="signal__ok">
          Liquidation mindestens {formatDeCompact(result.value.inputs.safetyFactor, 2)}× Stop-Abstand vom Entry
          entfernt, Risiko im Limit.
        </p>
      )}
    </section>
  );
}
