"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

type CopyState = "idle" | "copied" | "failed";

const FEEDBACK_MS = 1800;

async function writeClipboard(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or document not focused: try the legacy path below.
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

interface CopyButtonProps {
  /** Clipboard text; a function is evaluated at click time (e.g. for a timestamp). */
  value: string | (() => string);
  /** What is copied, for screen readers, e.g. "Positionswert USD". */
  subject: string;
  label?: string;
  /** Visual variant: `copy__button--primary` (filled cyan) or `copy__button--outline`. */
  className?: string;
}

export function CopyButton({ value, subject, label = "Kopieren", className }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    const ok = await writeClipboard(typeof value === "function" ? value() : value);
    setState(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), FEEDBACK_MS);
  }

  const text = state === "copied" ? "Kopiert" : state === "failed" ? "Bitte manuell kopieren" : label;

  return (
    <span className="copy">
      <button
        type="button"
        className={className ? `copy__button ${className}` : "copy__button"}
        data-state={state}
        onClick={copy}
        aria-label={state === "idle" ? `${subject} kopieren` : undefined}
      >
        <Icon name={state === "copied" ? "check" : "copy"} size={14} />
        {text}
      </button>
      <span role="status" className="sr-only">
        {state === "copied" ? `${subject} kopiert` : state === "failed" ? `${subject} konnte nicht kopiert werden` : ""}
      </span>
    </span>
  );
}
