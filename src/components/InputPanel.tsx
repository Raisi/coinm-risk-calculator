"use client";

import { useState, type ReactNode } from "react";
import { crvFromPrices, MAX_LEVERAGE, MIN_LEVERAGE, validLossPerUsd } from "@/lib/calc";
import { FIELD_LABELS, type InputError, type NumericField, type RawInputs } from "@/lib/evaluate";
import { formatDe, formatDeCompact, parseNumber } from "@/lib/format";
import { DEFAULT_CRV, tpInputForCrv } from "@/lib/form";

interface InputPanelProps {
  inputs: RawInputs;
  errors: InputError[];
  onChange: (patch: Partial<RawInputs>) => void;
}

const ASSUMPTION_FIELDS: NumericField[] = ["bufferPct", "mmr", "safetyFactor", "nearFactor"];

/** Drag range of the risk slider in whole percent; finer values like 0,25 are typed. 0 % shows the "> 0" error. */
const RISK_SLIDER = { min: 0, max: 100, step: 1 } as const;

/** CRV slider range in R; position while TP is empty or invalid. */
const CRV_SLIDER = { min: 0.5, max: 10, step: 0.1, fallback: DEFAULT_CRV } as const;

export function InputPanel({ inputs, errors, onChange }: InputPanelProps) {
  // Missing fields are listed in the status panel; inline messages are for wrong values only.
  const fieldError = (field: NumericField) =>
    errors.find((e) => e.field === field && e.kind !== "missing")?.message;
  const assumptionsInvalid = ASSUMPTION_FIELDS.some((f) => fieldError(f) !== undefined);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);

  const { direction } = inputs;
  const entry = parseNumber(inputs.entry);
  const stop = parseNumber(inputs.stop);
  const tp = parseNumber(inputs.tp);
  // Entry/stop the CRV slider works from; `null` disables it. Its position is the CRV of the current TP.
  const crvBase =
    entry !== null && stop !== null && validLossPerUsd(direction, entry, stop) !== null ? { entry, stop } : null;
  const crv = crvBase !== null && tp !== null ? crvFromPrices(direction, crvBase.entry, crvBase.stop, tp) : null;
  // Dragging the CRV slider writes the TP for that CRV on the price tick; unreachable values are ignored.
  const setTpFromCrv = (target: number) => {
    const next = tpInputForCrv(inputs, target);
    if (next !== null) onChange({ tp: next });
  };

  const field = (
    name: NumericField,
    extra: Partial<Pick<NumberFieldProps, "label" | "unit" | "hint" | "optional">> = {},
  ) => (
    <NumberField
      id={name}
      label={FIELD_LABELS[name]}
      value={inputs[name]}
      onChange={(value) => onChange({ [name]: value })}
      error={fieldError(name)}
      {...extra}
    />
  );

  return (
    <form className="inputs" onSubmit={(e) => e.preventDefault()} noValidate aria-label="Eingaben">
      <fieldset className="card group">
        <GroupTitle number="01">Konto &amp; Risiko</GroupTitle>
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
        {inputs.riskMode === "pct" ? (
          <SliderField
            id="riskPct"
            label={FIELD_LABELS.riskPct}
            value={inputs.riskPct}
            onChange={(riskPct) => onChange({ riskPct })}
            {...RISK_SLIDER}
            unit="%"
            formatValue={(v) => `${formatDeCompact(v, 2)} %`}
            error={fieldError("riskPct")}
          />
        ) : (
          field("riskBtc", { unit: "BTC" })
        )}
        {field("riskLimitPct", { unit: "%", hint: "Kursvorgabe: max. 5–10 % pro Trade" })}
      </fieldset>

      <fieldset className="card group">
        <GroupTitle number="02">Trade</GroupTitle>
        <Segmented
          name="direction"
          legend="Richtung"
          value={inputs.direction}
          options={[
            { value: "long", label: "Long", marker: "▲" },
            { value: "short", label: "Short", marker: "▼" },
          ]}
          onChange={(direction) => onChange({ direction })}
        />
        <div className="field-row">
          {field("entry", { unit: "USD" })}
          {field("stop", { unit: "USD" })}
        </div>
        {field("tp", { unit: "USD", optional: true })}
        <SliderField
          id="crv"
          label="CRV (setzt TP)"
          value={crv}
          onChange={(value) => setTpFromCrv(Number(value))}
          {...CRV_SLIDER}
          formatValue={(v) => `${formatDe(v, 2)} R`}
          readOnly
          disabled={crvBase === null}
          hint={crvBase === null ? "Entry und Stop eingeben" : undefined}
        />
      </fieldset>

      <fieldset className="card group">
        <GroupTitle number="03">Hebel &amp; Liquidation</GroupTitle>
        <SliderField
          id="leverage"
          label={FIELD_LABELS.leverage}
          value={inputs.leverage}
          onChange={(leverage) => onChange({ leverage })}
          min={MIN_LEVERAGE}
          max={MAX_LEVERAGE}
          step={1}
          integer
          unit="×"
          formatValue={(v) => `${v}x`}
          error={fieldError("leverage")}
        />
        {field("panelLiq", {
          unit: "USD",
          optional: true,
          hint: "Aus dem Bitunix-Orderpanel – wenn gesetzt, maßgeblich vor der Berechnung.",
        })}
      </fieldset>

      <details
        className="assumptions"
        open={assumptionsOpen || assumptionsInvalid}
        onToggle={(e) => setAssumptionsOpen(e.currentTarget.open)}
      >
        <summary>Annahmen &amp; Schwellen</summary>
        <div className="assumptions__body">
          {field("bufferPct", { unit: "%", hint: "wird vom Risiko abgezogen, bevor die Größe berechnet wird" })}
          {field("mmr", { label: "Maintenance-Margin-Rate m", hint: "0,004 = 0,4 %" })}
          {field("safetyFactor", { unit: "×", hint: "Liq-Abstand in Vielfachen des Stop-Abstands" })}
          {field("nearFactor", { unit: "×", label: "Nah-Schwelle (Faktor)", hint: "darunter: Rot" })}
        </div>
      </details>
    </form>
  );
}

/** Numbered card legend, e.g. "01 Konto & Risiko"; the number is decoration. */
function GroupTitle({ number, children }: { number: string; children: ReactNode }) {
  return (
    <legend className="section-title">
      <span className="section-title__num" aria-hidden="true">
        {number}
      </span>
      {children}
    </legend>
  );
}

interface NumberFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit?: string;
  hint?: ReactNode;
  /** Marks the label "· optional". */
  optional?: boolean;
  error?: string;
}

function NumberField({ id, label, value, onChange, unit, hint, optional, error }: NumberFieldProps) {
  const hintId = hint !== undefined ? `${id}-hint` : undefined;
  const errorId = error !== undefined ? `${id}-error` : undefined;
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
        {optional && <span className="field__optional"> · optional</span>}
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

interface SliderFieldProps {
  id: string;
  label: string;
  /** Raw typed value, or for a `readOnly` slider the number it shows (`null`: none, slider at `fallback`). */
  value: string | number | null;
  onChange: (value: string) => void;
  min: number;
  max: number;
  step: number;
  /** Slider position while `value` is empty or not a number; defaults to `min`. */
  fallback?: number;
  /** Unit beside the typed field. */
  unit?: string;
  /** Screen-reader text for the slider position; for a `readOnly` slider also the displayed value. */
  formatValue: (value: number) => string;
  /** Whole numbers only: numeric keypad and native number input instead of free decimal text. */
  integer?: boolean;
  /** Replaces the typed field with a read-only value box; typed input belongs to another field. */
  readOnly?: boolean;
  /** Applies to the slider; `hint` is shown below it and describes it. */
  disabled?: boolean;
  hint?: string;
  error?: string;
}

/**
 * Range slider plus a typed field bound to the same raw value (or a read-only value box);
 * values outside the range pin the slider.
 */
function SliderField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step,
  fallback = min,
  unit,
  formatValue,
  integer,
  readOnly,
  disabled,
  hint,
  error,
}: SliderFieldProps) {
  const parsed = typeof value === "string" ? parseNumber(value) : value;
  // Dividing by the inverse step keeps decimal steps exact (14 / 10 = 1.4, but 14 * 0.1 = 1.4000000000000001).
  // A noisy value would be restored into the range after an ignored change, and Chrome's sanitised
  // "1.4" would then arrive as a spurious change event.
  const sliderValue =
    parsed === null ? fallback : Math.min(max, Math.max(min, Math.round(parsed / step) / (1 / step)));
  const hintId = hint !== undefined ? `${id}-hint` : undefined;
  const errorId = error !== undefined ? `${id}-error` : undefined;
  // A read-only slider is the field's only control: it takes the label and announces the real
  // (unpinned) value. Otherwise the typed field takes the label and carries the real value.
  const shown = readOnly ? formatValue(parsed ?? fallback) : undefined;
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <div className="slider-field">
        <input
          type="range"
          className="slider-field__slider"
          id={readOnly ? id : undefined}
          min={min}
          max={max}
          step={step}
          value={sliderValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={readOnly ? undefined : `${label} (Schieberegler)`}
          aria-valuetext={shown ?? formatValue(sliderValue)}
          aria-describedby={hintId}
        />
        {readOnly ? (
          <output htmlFor={id} className="field__control slider-field__number slider-field__value" aria-live="off">
            {shown}
          </output>
        ) : (
          <span className="field__control slider-field__number">
            <input
              id={id}
              {...(integer
                ? { type: "number", inputMode: "numeric", min, max, step }
                : { type: "text", inputMode: "decimal", autoComplete: "off", spellCheck: false })}
              value={value ?? ""}
              onChange={(e) => onChange(e.target.value)}
              aria-invalid={error !== undefined}
              aria-describedby={errorId}
            />
            {unit !== undefined && <span className="field__unit">{unit}</span>}
          </span>
        )}
      </div>
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
  /** `marker` is a decorative glyph before the label; options with a marker get their own active colour. */
  options: { value: T; label: string; marker?: string }[];
  onChange: (value: T) => void;
}

function Segmented<T extends string>({ name, legend, value, options, onChange }: SegmentedProps<T>) {
  return (
    <fieldset className="segmented">
      <legend className="field__label">{legend}</legend>
      <div className="segmented__options">
        {options.map((option) => (
          <label
            key={option.value}
            className="segmented__option"
            data-tone={option.marker !== undefined ? option.value : undefined}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>
              {option.marker !== undefined && <span aria-hidden="true">{option.marker}</span>}
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
