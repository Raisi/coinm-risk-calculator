"use client";

import { useMemo, useState } from "react";
import { DEFAULT_INPUTS, evaluate, type RawInputs } from "@/lib/evaluate";
import { InputPanel } from "./InputPanel";
import { Results } from "./Results";
import { Warnings } from "./Warnings";

export function Calculator() {
  const [inputs, setInputs] = useState<RawInputs>(DEFAULT_INPUTS);
  const result = useMemo(() => evaluate(inputs), [inputs]);

  return (
    <div className="calculator">
      <InputPanel
        inputs={inputs}
        errors={result.ok ? [] : result.errors}
        onChange={(patch) => setInputs((previous) => ({ ...previous, ...patch }))}
      />
      <div className="outputs">
        <Warnings result={result} />
        {result.ok ? (
          <Results evaluation={result.value} />
        ) : (
          <p className="empty">
            Sobald Entry, Stop und alle übrigen Pflichtfelder gültig sind, erscheinen hier Positionsgröße, Margin,
            Liquidationspreis und die Kopierwerte für Bitunix.
          </p>
        )}
      </div>
    </div>
  );
}
