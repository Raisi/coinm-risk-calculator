"use client";

import { useState, type ReactNode } from "react";
import { MAX_LEVERAGE, MIN_LEVERAGE } from "@/lib/calc";
import { FIELD_LABELS, type InputError, type NumericField, type RawInputs } from "@/lib/evaluate";
import { parseNumber } from "@/lib/format";

interface InputPanelProps {
  inputs: RawInputs;
  errors: InputError[];
  onChange: (patch: Partial<RawInputs>) => void;
}

const ASSUMPTION_FIELDS: NumericField[] = ["bufferPct", "mmr", "safetyFactor", "nearFactor"];

export function InputPanel({ inputs, errors, onChange }: InputPanelProps) {
  // Missing fields are listed in the status panel; inline messages are for wrong values only.
  const fieldError = (field: NumericField) =>
    errors.find((e) => e.field === field && e.kind !== "missing")?.message;
  const assumptionsInvalid = ASSUMPTION_FIELDS.some((f) => fieldError(f) !== undefined);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);

  const field = (name: NumericField, extra: Partial<Pick<NumberFieldProps, "label" | "unit" | "hint">> = {}) => (
    <NumberField
      id={name}
      label={FIELD_LABELS[name]}
      value={inputs[name]}
      onChange={(value) => onChange({ [name]: value })}
      error={fieldError(name)}
      {...extra}
    />
  );

  const parsedLeverage = parseNumber(inputs.leverage);
  const sliderLeverage =
    parsedLeverage === null ? MIN_LEVERAGE : Math.min(MAX_LEVERAGE, Math.max(MIN_LEVERAGE, Math.round(parsedLeverage)));

  return (
    <form className="inputs" onSubmit={(e) => e.preventDefault()} noValidate aria-label="Eingaben">
      <fieldset className="group">
        <legend className="group__title">Konto &amp; Risiko</legend>
        {field("balance", { unit: "BTC" })}
        <Segmented
          name="riskMode"
          legend="Risiko-Modus"
          value={inputs.riskMode}
          options={[
            { value: "pct", label: "in %" },
            { value: "btc", label: "in BTC" },
          ]}
          onChange={(riskMode) => onChange({ riskMode })}
        />
        {inputs.riskMode === "pct" ? field("riskPct", { unit: "%" }) : field("riskBtc", { unit: "BTC" })}
        {field("riskLimitPct", { unit: "%", hint: "Kursvorgabe: max. 5–10 % pro Trade" })}
      </fieldset>

      <fieldset className="group">
        <legend className="group__title">Trade</legend>
        <Segmented
          name="direction"
          legend="Richtung"
          value={inputs.direction}
          options={[
            { value: "long", label: "Long" },
            { value: "short", label: "Short" },
          ]}
          onChange={(direction) => onChange({ direction })}
        />
        <div className="field-row">
          {field("entry", { unit: "USD" })}
          {field("stop", { unit: "USD" })}
        </div>
        {field("tp", { unit: "USD", hint: "optional" })}
      </fieldset>

      <fieldset className="group">
        <legend className="group__title">Hebel &amp; Liquidation</legend>
        <div className="leverage">
          <label htmlFor="leverage" className="field__label">
            {FIELD_LABELS.leverage}
          </label>
          <div className="leverage__controls">
            <input
              type="range"
              className="leverage__slider"
              min={MIN_LEVERAGE}
              max={MAX_LEVERAGE}
              step={1}
              value={sliderLeverage}
              onChange={(e) => onChange({ leverage: e.target.value })}
              aria-label={`${FIELD_LABELS.leverage} (Schieberegler)`}
              aria-valuetext={`${sliderLeverage}x`}
            />
            <span className="field__control leverage__number">
              <input
                id="leverage"
                type="number"
                inputMode="numeric"
                min={MIN_LEVERAGE}
                max={MAX_LEVERAGE}
                step={1}
                value={inputs.leverage}
                onChange={(e) => onChange({ leverage: e.target.value })}
                aria-invalid={fieldError("leverage") !== undefined}
                aria-describedby={fieldError("leverage") !== undefined ? "leverage-error" : undefined}
              />
              <span className="field__unit">x</span>
            </span>
          </div>
          {fieldError("leverage") !== undefined && (
            <p id="leverage-error" className="field__error">
              {fieldError("leverage")}
            </p>
          )}
        </div>
        {field("panelLiq", {
          unit: "USD",
          hint: "optional – aus dem Bitunix-Orderpanel; maßgeblich vor der Berechnung",
        })}
      </fieldset>

      <details
        className="group group--details"
        open={assumptionsOpen || assumptionsInvalid}
        onToggle={(e) => setAssumptionsOpen(e.currentTarget.open)}
      >
        <summary className="group__title">Annahmen &amp; Schwellen</summary>
        <div className="group__body">
          {field("bufferPct", { unit: "%", hint: "wird vom Risiko abgezogen, bevor die Größe berechnet wird" })}
          {field("mmr", { label: "Maintenance-Margin-Rate m", hint: "0,004 = 0,4 %" })}
          {field("safetyFactor", { unit: "×", hint: "Liq-Abstand in Vielfachen des Stop-Abstands" })}
          {field("nearFactor", { unit: "×", label: "Nah-Schwelle (Faktor)", hint: "darunter: Rot" })}
        </div>
      </details>
    </form>
  );
}

interface NumberFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit?: string;
  hint?: ReactNode;
  error?: string;
}

function NumberField({ id, label, value, onChange, unit, hint, error }: NumberFieldProps) {
  const hintId = hint !== undefined ? `${id}-hint` : undefined;
  const errorId = error !== undefined ? `${id}-error` : undefined;
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <span className="field__control">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error !== undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        />
        {unit !== undefined && <span className="field__unit">{unit}</span>}
      </span>
      {hint !== undefined && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="field__error">
          {error}
        </p>
      )}
    </div>
  );
}

interface SegmentedProps<T extends string> {
  name: string;
  legend: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

function Segmented<T extends string>({ name, legend, value, options, onChange }: SegmentedProps<T>) {
  return (
    <fieldset className="segmented">
      <legend className="field__label">{legend}</legend>
      <div className="segmented__options">
        {options.map((option) => (
          <label key={option.value} className="segmented__option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
