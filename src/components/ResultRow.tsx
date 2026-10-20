import type { ReactNode } from "react";
import { CopyButton } from "./CopyButton";

interface ResultRowProps {
  label: string;
  /** Secondary line under the label, e.g. the Bitunix unit setting. */
  hint?: ReactNode;
  value: ReactNode;
  /** Exact string placed on the clipboard; shows the copy value and a copy button. */
  copyValue?: string;
}

export function ResultRow({ label, hint, value, copyValue }: ResultRowProps) {
  return (
    <div className={copyValue === undefined ? "result" : "result result--copy"}>
      <dt className="result__label">
        {label}
        {hint !== undefined && <span className="result__hint">{hint}</span>}
      </dt>
      <dd className="result__value">
        <span className="result__display">{value}</span>
        {copyValue !== undefined && (
          <span className="result__copy">
            <code className="result__raw" title="Kopierwert">
              {copyValue}
            </code>
            <CopyButton value={copyValue} subject={label} />
          </span>
        )}
      </dd>
    </div>
  );
}
