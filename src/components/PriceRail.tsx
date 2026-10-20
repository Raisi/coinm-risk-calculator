"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { LiqCheck } from "@/lib/evaluate";
import { formatDe } from "@/lib/format";
import { MOTION, toneColor, useReducedMotion, type Tone } from "./motion";

interface PriceRailProps {
  entry: number;
  stop: number;
  tp: number | null;
  liq: LiqCheck;
  panelLiq: LiqCheck | null;
}

interface Marker {
  key: "stop" | "entry" | "tp" | "liq" | "panelLiq";
  label: string;
  price: number;
  tone: Tone | "ink";
  below: boolean;
}

/** Share of the price range added on each side so edge markers keep room for their labels. */
const DOMAIN_PADDING = 0.12;
/** Minimum horizontal gap between two labels in the same lane, in px. */
const LABEL_GAP_PX = 8;
/** How far an edge-aligned label may extend past its tick, in px (matches the CSS 0.25rem nudge). */
const EDGE_NUDGE_PX = 4;

/**
 * Places every label inside the rail (centred on its tick, or edge-aligned near the ends)
 * and stacks overlapping labels into extra lanes per side. Reads target positions from
 * `data-pos`, measures real label widths, and writes only CSS variables / data attributes
 * that React does not render, so it is safe to run on every update and on resize.
 */
function layoutLabels(rail: HTMLElement) {
  const width = rail.clientWidth;
  const laneCount = { above: 0, below: 0 };
  for (const side of ["above", "below"] as const) {
    const items = Array.from(rail.querySelectorAll<HTMLElement>(`.rail__marker.is-${side}`)).map((marker) => {
      const label = marker.querySelector<HTMLElement>(".rail__label")!;
      const x = (Number(marker.dataset.pos) / 100) * width;
      const w = label.offsetWidth;
      let align: "center" | "start" | "end" = "center";
      let left = x - w / 2;
      if (left < 0 || x + w / 2 > width) {
        align = x < width / 2 ? "start" : "end";
        left = align === "start" ? x - EDGE_NUDGE_PX : x + EDGE_NUDGE_PX - w;
      }
      label.dataset.align = align;
      return { label, left, right: left + w };
    });
    items.sort((a, b) => a.left - b.left);
    const laneEnds: number[] = [];
    for (const item of items) {
      let lane = laneEnds.findIndex((end) => item.left >= end + LABEL_GAP_PX);
      if (lane === -1) lane = laneEnds.push(item.right) - 1;
      else laneEnds[lane] = item.right;
      item.label.style.setProperty("--lane", String(lane));
    }
    laneCount[side] = laneEnds.length;
  }
  rail.style.setProperty("--above", String(laneCount.above));
  rail.style.setProperty("--below", String(laneCount.below));
}

export function PriceRail({ entry, stop, tp, liq, panelLiq }: PriceRailProps) {
  const root = useRef<HTMLDivElement>(null);
  const placed = useRef(new Set<Marker["key"]>());
  const reduced = useReducedMotion();

  const markers: Marker[] = [
    { key: "stop", label: "Stop", price: stop, tone: "ink", below: false },
    { key: "entry", label: "Entry", price: entry, tone: "ink", below: false },
  ];
  if (tp !== null) markers.push({ key: "tp", label: "TP", price: tp, tone: "ink", below: false });
  if (Number.isFinite(liq.price)) {
    markers.push({ key: "liq", label: "Liq", price: liq.price, tone: liq.status, below: true });
  }
  if (panelLiq !== null) {
    markers.push({ key: "panelLiq", label: "Liq Panel", price: panelLiq.price, tone: panelLiq.status, below: true });
  }

  const prices = markers.map((m) => m.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = (max - min) * DOMAIN_PADDING || max * 0.01;
  const lo = min - pad;
  const span = max + pad - lo;
  const positions = markers.map((m) => ((m.price - lo) / span) * 100);
  const renderKey = markers.map((m) => `${m.key}:${m.price}:${m.tone}`).join("|");

  useGSAP(
    () => {
      const rail = root.current;
      if (!rail) return;
      layoutLabels(rail);
      markers.forEach((marker, i) => {
        const el = rail.querySelector<HTMLElement>(`[data-marker="${marker.key}"]`);
        if (!el) return;
        const vars: gsap.TweenVars = { left: `${positions[i]}%` };
        if (marker.tone !== "ink") vars.color = toneColor(marker.tone);
        if (!placed.current.has(marker.key) || reduced.current) {
          gsap.set(el, vars);
        } else {
          gsap.to(el, { ...vars, ...MOTION, overwrite: "auto" });
        }
      });
      placed.current = new Set(markers.map((m) => m.key));
    },
    { dependencies: [renderKey], scope: root },
  );

  // Label widths are fixed in px while positions are relative: re-stack lanes when the rail width changes.
  useEffect(() => {
    const rail = root.current;
    if (!rail) return;
    let lastWidth = rail.clientWidth;
    const observer = new ResizeObserver(() => {
      if (rail.clientWidth === lastWidth) return;
      lastWidth = rail.clientWidth;
      layoutLabels(rail);
    });
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);

  const description = [...markers]
    .sort((a, b) => a.price - b.price)
    .map((m) => `${m.label} ${formatDe(m.price, 1)}`)
    .join(", ");

  return (
    <div className="rail" ref={root} role="img" aria-label={`Preisleiste (USD, aufsteigend): ${description}`}>
      <div className="rail__track" aria-hidden="true" />
      {markers.map((marker, i) => (
        <div
          key={marker.key}
          className={`rail__marker rail__marker--${marker.key} ${marker.below ? "is-below" : "is-above"}`}
          data-marker={marker.key}
          data-pos={positions[i]}
          aria-hidden="true"
        >
          <span className="rail__label">
            <span className="rail__name">{marker.label}</span>
            <span className="rail__price">{formatDe(marker.price, 1)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
