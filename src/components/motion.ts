"use client";

import { useRef, type RefObject } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { Status } from "@/lib/evaluate";

gsap.registerPlugin(useGSAP);

export const MOTION = { duration: 0.6, ease: "expo.out" } as const;

/** Traffic-light tone; `neutral` while inputs are incomplete or invalid. */
export type Tone = Status | "neutral";

/**
 * Tracks prefers-reduced-motion through gsap.matchMedia. Starts as `true`
 * so nothing animates before the preference is known.
 */
export function useReducedMotion(): RefObject<boolean> {
  const reduced = useRef(true);
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add(
      {
        reduce: "(prefers-reduced-motion: reduce)",
        motion: "(prefers-reduced-motion: no-preference)",
      },
      (context) => {
        reduced.current = Boolean(context.conditions?.reduce);
      },
    );
  });
  return reduced;
}

/** Colour from the CSS custom property `--status-<tone>` (hex, so GSAP can interpolate it). */
export function toneColor(tone: Tone): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--status-${tone}`).trim();
}
