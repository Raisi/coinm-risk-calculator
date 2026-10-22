"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  balanceRate,
  balanceRateHint,
  TEXT_BALANCE_RATE_FAILED,
  TEXT_BALANCE_RATE_MISSING,
  type BalanceRate,
} from "@/lib/balanceLink";
import { crvFromPrices, MAX_LEVERAGE, MIN_LEVERAGE, validLossPerUsd } from "@/lib/calc";
import {
  FIELD_LABELS,
  TP_PART_FIELDS,
  type InputError,
  type NumericField,
  type RawInputs,
} from "@/lib/evaluate";
import { formatDe, formatDeCompact, parseNumber } from "@/lib/format";
import { DEFAULT_CRV, tpInputForCrvText } from "@/lib/form";
import { livePriceEntry, TEXT_LIVE_PRICE_FAILED } from "@/lib/livePrice";
import { Icon } from "./Icon";
import { useLivePrice } from "./useLivePrice";

interface InputPanelProps {
  inputs: RawInputs;
  /** CRV TP is derived from; `null` while TP is typed. Shown while TP is empty. */
  targetCrv: number | null;
  /** Last fetched live price linking Kontostand BTC and USDT; `null` until one is fetched. */
  balanceRate: BalanceRate | null;
  errors: InputError[];
  onChange: (patch: Partial<RawInputs>) => void;
  /** A CRV from the slider or the CRV field; ignored when not reachable. */
  onCrvChange: (crv: number) => void;
  /** A live price fetched by either button; it becomes the balance rate. */
  onBalanceRate: (rate: BalanceRate) => void;
}

const ASSUMPTION_FIELDS: NumericField[] = ["bufferPct", "mmr", "safetyFactor", "nearFactor"];

/** Drag range of the risk slider in whole percent; finer values like 0,25 are typed. 0 % shows the "> 0" error. */
const RISK_SLIDER = { min: 0, max: 100, step: 1 } as const;

/** CRV slider range in R; position while the CRV field holds no number. */
const CRV_SLIDER = { min: 0.5, max: 10, step: 0.1, fallback: DEFAULT_CRV } as const;

/** Accessible name of the live price button; starts with its visible text. */
const LIVE_PRICE_LABEL = "Aktueller Kurs von Binance als Entry übernehmen";

/** Accessible name of the balance rate button; starts with its visible text. */
const BALANCE_RATE_LABEL = "Kurs laden: aktueller Binance-Kurs zum Umrechnen von BTC und USDT";

/** The linked Kontostand pair, BTC first. */
const BALANCE_FIELDS = [
  { name: "balance", unit: "BTC" },
  { name: "balanceUsdt", unit: "USDT" },
] as const;

export function InputPanel({
  inputs,
  targetCrv,
  balanceRate: rate,
  errors,
  onChange,
  onCrvChange,
  onBalanceRate,
}: InputPanelProps) {
  // Missing fields are listed in the status panel; inline messages are for wrong values only.
  const fieldError = (field: NumericField) =>
    errors.find((e) => e.field === field && e.kind !== "missing")?.message;
  const assumptionsInvalid = ASSUMPTION_FIELDS.some((f) => fieldError(f) !== undefined);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  // One live price for both buttons. A fetched Entry goes through the same patch as a typed Entry, so a CRV
  // target recomputes TP; every fetched quote also becomes the balance rate.
  const livePrice = useLivePrice((quote, target, receivedAt) => {
    if (target === "entry") onChange({ entry: livePriceEntry(quote.price) });
    onBalanceRate(balanceRate(quote, receivedAt));
  });

  const { account, direction, crvBasis } = inputs;
  const accountUnit = account === "btc" ? "BTC" : "USDT";
  // The balance field sizing reads (see `evaluate`); the other one is only the linked conversion.
  const balanceUsed = account === "btc" ? "balance" : "balanceUsdt";
  const entry = parseNumber(inputs.entry);
  const stop = parseNumber(inputs.stop);
  const tp = parseNumber(inputs.tp);
  // Entry/stop the CRV slider and field work from; `null` disables them. They show the CRV of the current
  // TP in the active basis, or while TP is empty the CRV target.
  const crvBase =
    entry !== null && stop !== null && validLossPerUsd(direction, entry, stop) !== null ? { entry, stop } : null;
  const crv =
    crvBase !== null && tp !== null ? crvFromPrices(crvBasis, direction, crvBase.entry, crvBase.stop, tp) : null;
  // Unparseable shares count as 0 here; their fields show the error.
  const shareSum = TP_PART_FIELDS.reduce((sum, part) => sum + (parseNumber(inputs[part.share]) ?? 0), 0);
  // Accepted CRV shown by the slider and, unless being edited, the field. Once the user edits the focused
  // field it keeps the typed draft until blur; the slider never follows a draft. Focus alone starts no
  // draft, so the rounded display text is never validated as if typed.
  const crvShown = formatDe(crv ?? targetCrv ?? DEFAULT_CRV, 2);
  const crvFieldFocused = useRef(false);
  const [crvDraft, setCrvDraft] = useState<string | null>(null);
  const crvTyped = crvDraft === null ? null : tpInputForCrvText(inputs, crvDraft);
  const crvError = crvTyped !== null && "error" in crvTyped ? (crvTyped.error ?? undefined) : undefined;
  // Slider and field set the CRV target; an invalid or unreachable CRV leaves target and TP unchanged.
  const setCrv = (text: string) => {
    if (crvFieldFocused.current) setCrvDraft(text);
    const value = parseNumber(text);
    if (value !== null) onCrvChange(value);
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
        <Segmented
          name="account"
          legend="Konto in"
          value={account}
          options={[
            { value: "btc", label: "BTC" },
            { value: "usdt", label: "USDT" },
          ]}
          onChange={(value) => onChange({ account: value })}
        />
        <div className="balance-pair">
          <div className="field-row">
            {BALANCE_FIELDS.map(({ name, unit }) => (
              <NumberField
                key={name}
                id={name}
                label={`${FIELD_LABELS[name]} ${unit}`}
                value={inputs[name]}
                onChange={(value) => onChange({ [name]: value })}
                unit={unit}
                hint={name === balanceUsed ? "zählt für die Berechnung" : "nur Umrechnung"}
                className={name === balanceUsed ? undefined : "field--linked"}
                readOnly={name !== balanceUsed}
                error={fieldError(name)}
              />
            ))}
          </div>
          <div className="balance-rate">
            <button
              type="button"
              className="live-price"
              onClick={() => livePrice.load("balance")}
              disabled={livePrice.loading}
              aria-busy={livePrice.state.balance.kind === "loading"}
              aria-label={BALANCE_RATE_LABEL}
              title={BALANCE_RATE_LABEL}
            >
              <Icon name="refresh" size={14} />
              Kurs laden
            </button>
            <div className="balance-rate__status" aria-live="polite">
              <p className="field__hint">{rate !== null ? balanceRateHint(rate) : TEXT_BALANCE_RATE_MISSING}</p>
              {livePrice.state.balance.kind === "failed" && (
                <p className="field__error">{TEXT_BALANCE_RATE_FAILED}</p>
              )}
            </div>
          </div>
        </div>
        <Segmented
          name="riskMode"
          legend="Risiko-Modus"
          value={inputs.riskMode}
          options={[
            { value: "pct", label: "in %" },
            { value: "amount", label: `in ${accountUnit}` },
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
        ) : account === "btc" ? (
          field("riskBtc", { unit: "BTC" })
        ) : (
          field("riskUsdt", { unit: "USDT", hint: "Verlust bei Stop, bewertet zum Stop-Kurs" })
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
          <NumberField
            id="entry"
            label={FIELD_LABELS.entry}
            value={inputs.entry}
            onChange={(entry) => {
              livePrice.cancel("entry");
              onChange({ entry });
            }}
            unit="USD"
            error={fieldError("entry")}
            action={
              <button
                type="button"
                className="live-price"
                onClick={() => livePrice.load("entry")}
                disabled={livePrice.loading}
                aria-busy={livePrice.state.entry.kind === "loading"}
                aria-label={LIVE_PRICE_LABEL}
                title={LIVE_PRICE_LABEL}
              >
                <Icon name="refresh" size={14} />
                Aktueller Kurs
              </button>
            }
            actionStatus={
              livePrice.state.entry.kind === "done"
                ? { text: livePrice.state.entry.hint, error: false }
                : livePrice.state.entry.kind === "failed"
                  ? { text: TEXT_LIVE_PRICE_FAILED, error: true }
                  : undefined
            }
          />
          {field("stop", { unit: "USD" })}
        </div>
        {field("tp", { unit: "USD", optional: true })}
        <Segmented
          name="crvBasis"
          legend="CRV-Basis"
          value={crvBasis}
          options={[
            { value: "btc", label: "BTC" },
            { value: "usd", label: "USD" },
          ]}
          onChange={(value) => onChange({ crvBasis: value })}
          hint="USD = linear wie Chart/Tabelle, BTC = Gewinn in BTC"
        />
        <SliderField
          id="crv"
          label="CRV (setzt TP)"
          value={crvShown}
          draft={crvDraft}
          onChange={setCrv}
          onFocus={() => {
            crvFieldFocused.current = true;
          }}
          onBlur={() => {
            crvFieldFocused.current = false;
            setCrvDraft(null);
          }}
          {...CRV_SLIDER}
          unit="R"
          formatValue={(v) => `${formatDe(v, 2)} R`}
          disabled={crvBase === null}
          hint={crvBase === null ? "Entry und Stop eingeben" : undefined}
          error={crvError}
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

      <fieldset className="card group">
        <GroupTitle number="04">Take-Profit-Plan</GroupTitle>
        <Segmented
          name="tpPlan"
          legend="Anzeige"
          value={inputs.tpPlan}
          options={[
            { value: "ladder", label: "CRV-Stufen" },
            { value: "partial", label: "Teil-TPs" },
          ]}
          onChange={(tpPlan) => onChange({ tpPlan })}
          hint={
            inputs.tpPlan === "ladder"
              ? "TP-Preise von 1 bis 10 R in der CRV-Basis"
              : "Bis zu drei TPs, jeder schließt einen Anteil der Position"
          }
        />
        {inputs.tpPlan === "partial" && (
          <>
            {TP_PART_FIELDS.map((part) => (
              <div key={part.crv} className="field-row">
                {field(part.crv, { unit: "R" })}
                {field(part.share, { unit: "%" })}
              </div>
            ))}
            <p className="field__hint">Summe der Anteile: {formatDeCompact(shareSum, 2)} % (muss 100 % ergeben)</p>
          </>
        )}
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
  /** Control below the input, e.g. the "Aktueller Kurs" button. */
  action?: ReactNode;
  /** Result of `action`, shown below it in a polite live region (rendered with `action`, so it is announced). */
  actionStatus?: { text: string; error: boolean };
  /** Modifier class of the field wrapper, e.g. `field--linked`. */
  className?: string;
  /** Shown but not editable, e.g. the balance the calculation does not use. */
  readOnly?: boolean;
}

function NumberField({
  id,
  label,
  value,
  onChange,
  unit,
  hint,
  optional,
  error,
  action,
  actionStatus,
  className,
  readOnly,
}: NumberFieldProps) {
  const hintId = hint !== undefined ? `${id}-hint` : undefined;
  const errorId = error !== undefined ? `${id}-error` : undefined;
  const statusId = action !== undefined ? `${id}-status` : undefined;
  return (
    <div className={className === undefined ? "field" : `field ${className}`}>
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
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error !== undefined}
          aria-describedby={
            [hintId, errorId, actionStatus !== undefined ? statusId : undefined].filter(Boolean).join(" ") ||
            undefined
          }
        />
        {unit !== undefined && <span className="field__unit">{unit}</span>}
      </span>
      {action !== undefined && (
        <div className="field__action">
          {action}
          <p id={statusId} className={actionStatus?.error ? "field__error" : "field__hint"} aria-live="polite">
            {actionStatus?.text}
          </p>
        </div>
      )}
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
  /** Raw value; the slider follows it. */
  value: string;
  /** Text the typed field shows instead of `value` while it is being edited; the slider ignores it. */
  draft?: string | null;
  /** Called by both the slider and the typed field. */
  onChange: (value: string) => void;
  /** Focus and blur of the typed field. */
  onFocus?: () => void;
  onBlur?: () => void;
  min: number;
  max: number;
  step: number;
  /** Slider position while `value` is empty or not a number; defaults to `min`. */
  fallback?: number;
  /** Unit beside the typed field. */
  unit?: string;
  /** Screen-reader text for the slider position. */
  formatValue: (value: number) => string;
  /** Whole numbers only: numeric keypad and native number input instead of free decimal text. */
  integer?: boolean;
  /** Applies to the slider and the typed field; `hint` is shown below and describes both. */
  disabled?: boolean;
  hint?: string;
  error?: string;
}

/** Range slider plus a typed field bound to the same raw value; values outside the range pin the slider. */
function SliderField({
  id,
  label,
  value,
  draft,
  onChange,
  onFocus,
  onBlur,
  min,
  max,
  step,
  fallback = min,
  unit,
  formatValue,
  integer,
  disabled,
  hint,
  error,
}: SliderFieldProps) {
  const parsed = parseNumber(value);
  // Dividing by the inverse step keeps decimal steps exact (14 / 10 = 1.4, but 14 * 0.1 = 1.4000000000000001).
  // A noisy value would be restored into the range after an ignored change, and Chrome's sanitised
  // "1.4" would then arrive as a spurious change event.
  const sliderValue =
    parsed === null ? fallback : Math.min(max, Math.max(min, Math.round(parsed / step) / (1 / step)));
  const hintId = hint !== undefined ? `${id}-hint` : undefined;
  const errorId = error !== undefined ? `${id}-error` : undefined;
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <div className="slider-field">
        <input
          type="range"
          className="slider-field__slider"
          min={min}
          max={max}
          step={step}
          value={sliderValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={`${label} (Schieberegler)`}
          aria-valuetext={formatValue(sliderValue)}
          aria-describedby={hintId}
        />
        <span className="field__control slider-field__number">
          <input
            id={id}
            {...(integer
              ? { type: "number", inputMode: "numeric", min, max, step }
              : { type: "text", inputMode: "decimal", autoComplete: "off", spellCheck: false })}
            value={draft ?? value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            disabled={disabled}
            aria-invalid={error !== undefined}
            aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
          />
          {unit !== undefined && <span className="field__unit">{unit}</span>}
        </span>
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
  /** Short explanation below the options; describes the group. */
  hint?: string;
}

function Segmented<T extends string>({ name, legend, value, options, onChange, hint }: SegmentedProps<T>) {
  const hintId = hint !== undefined ? `${name}-hint` : undefined;
  return (
    <fieldset className="segmented" aria-describedby={hintId}>
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
      {hint !== undefined && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
    </fieldset>
  );
}
