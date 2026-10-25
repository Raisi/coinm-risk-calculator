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
  /**
   * Clipboard text; a function is evaluated at click time (e.g. for a timestamp). `null`: nothing to copy,
   * the button is disabled.
   */
  value: string | (() => string) | null;
  /** What is copied, for screen readers, e.g. "Positionswert USD". */
  subject: string;
  label?: string;
  /** Visual variant: `copy__button--primary` (filled cyan), `copy__button--outline` or `copy__button--icon`. */
  className?: string;
  /** Shows only the icon; the text stays the accessible name and becomes the tooltip. */
  iconOnly?: boolean;
}

export function CopyButton({ value, subject, label = "Kopieren", className, iconOnly }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    if (value === null) return;
    const ok = await writeClipboard(typeof value === "function" ? value() : value);
    setState(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), FEEDBACK_MS);
  }

  const text = state === "copied" ? "Kopiert" : state === "failed" ? "Bitte manuell kopieren" : label;
  const name = state === "idle" ? `${subject} kopieren` : undefined;

  return (
    <span className="copy">
      <button
        type="button"
        className={className ? `copy__button ${className}` : "copy__button"}
        data-state={state}
        onClick={copy}
        disabled={value === null}
        aria-label={name}
        title={iconOnly ? (name ?? text) : undefined}
      >
        <Icon name={state === "copied" ? "check" : "copy"} size={14} />
        {iconOnly ? <span className="sr-only">{text}</span> : text}
      </button>
      <span role="status" className="sr-only">
        {state === "copied" ? `${subject} kopiert` : state === "failed" ? `${subject} konnte nicht kopiert werden` : ""}
      </span>
    </span>
  );
}
