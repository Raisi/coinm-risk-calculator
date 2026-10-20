import type { ReactNode } from "react";

interface ResultRowProps {
  label: string;
  /** Secondary line under the label, e.g. the basis of the value. */
  hint?: ReactNode;
  value: ReactNode;
}

export function ResultRow({ label, hint, value }: ResultRowProps) {
  return (
    <div className="result">
      <dt className="result__label">
        {label}
        {hint !== undefined && <span className="result__hint">{hint}</span>}
      </dt>
      <dd className="result__value">{value}</dd>
    </div>
  );
}
