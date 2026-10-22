"use client";

import { useMemo, useReducer } from "react";
import { evaluate } from "@/lib/evaluate";
import { formReducer, INITIAL_FORM_STATE } from "@/lib/form";
import { InputPanel } from "./InputPanel";
import { Results } from "./Results";
import { Warnings } from "./Warnings";

export function Calculator() {
  const [{ inputs, target, balanceRate }, dispatch] = useReducer(formReducer, INITIAL_FORM_STATE);
  const result = useMemo(() => evaluate(inputs), [inputs]);

  return (
    <div className="calculator">
      <InputPanel
        inputs={inputs}
        errors={result.ok ? [] : result.errors}
        targetCrv={target.kind === "crv" ? target.crv : null}
        balanceRate={balanceRate}
        onChange={(patch) => dispatch({ type: "patch", patch })}
        onCrvChange={(crv) => dispatch({ type: "crv", crv })}
        onBalanceRate={(rate) => dispatch({ type: "balanceRate", rate })}
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
