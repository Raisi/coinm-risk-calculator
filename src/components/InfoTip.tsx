"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * Small info disclosure: the button toggles a short explanation (tap-friendly, unlike a hover tooltip).
 * Escape and clicks outside close it. The panel is positioned against the nearest `position: relative` ancestor.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={root} className="infotip">
      <button
        type="button"
        className="infotip__button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="info" size={14} />
      </button>
      <span id={panelId} role="note" className="infotip__panel" hidden={!open}>
        {children}
      </span>
    </span>
  );
}
