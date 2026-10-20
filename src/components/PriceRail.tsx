"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { LiqCheck } from "@/lib/evaluate";
import { formatDe } from "@/lib/format";
import { MOTION, useReducedMotion } from "./motion";

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
}

/** Coloured track segment between two prices: risk = Stop→Entry, chance = Entry→TP. */
interface Zone {
  key: "risk" | "chance";
  from: number;
  to: number;
}

/** Share of the price range added on each side so edge markers keep room for their labels. */
const DOMAIN_PADDING = 0.12;
/** Minimum horizontal gap between two labels in the same lane, in px. */
const LABEL_GAP_PX = 8;
/** How far an edge-aligned label may extend past its tick, in px (matches the CSS 0.25rem nudge). */
const EDGE_NUDGE_PX = 4;

/**
 * Places every label inside the rail (centred on its tick, or edge-aligned near the ends)
 * and stacks overlapping labels into extra lanes above the track. Reads target positions from
 * `data-pos`, measures real label widths, and writes only CSS variables / data attributes
 * that React does not render, so it is safe to run on every update and on resize.
 */
function layoutLabels(rail: HTMLElement) {
  const width = rail.clientWidth;
  const items = Array.from(rail.querySelectorAll<HTMLElement>(".rail__marker")).map((marker) => {
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
    return { marker, left, right: left + w };
  });
  items.sort((a, b) => a.left - b.left);
  const laneEnds: number[] = [];
  for (const item of items) {
    let lane = laneEnds.findIndex((end) => item.left >= end + LABEL_GAP_PX);
    if (lane === -1) lane = laneEnds.push(item.right) - 1;
    else laneEnds[lane] = item.right;
    // On the marker so both the label and its tick (which reaches up to the label) follow the lane.
    item.marker.style.setProperty("--lane", String(lane));
  }
  rail.style.setProperty("--lanes", String(Math.max(1, laneEnds.length)));
}

export function PriceRail({ entry, stop, tp, liq, panelLiq }: PriceRailProps) {
  const root = useRef<HTMLDivElement>(null);
  const placed = useRef(new Set<string>());
  const reduced = useReducedMotion();

  const markers: Marker[] = [
    { key: "stop", label: "Stop", price: stop },
    { key: "entry", label: "Entry", price: entry },
  ];
  if (tp !== null) markers.push({ key: "tp", label: "TP", price: tp });
  if (Number.isFinite(liq.price)) markers.push({ key: "liq", label: "Liq", price: liq.price });
  if (panelLiq !== null) markers.push({ key: "panelLiq", label: "Liq Panel", price: panelLiq.price });

  const zones: Zone[] = [{ key: "risk", from: stop, to: entry }];
  if (tp !== null) zones.push({ key: "chance", from: entry, to: tp });

  const prices = markers.map((m) => m.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = (max - min) * DOMAIN_PADDING || max * 0.01;
  const lo = min - pad;
  const span = max + pad - lo;
  const toPct = (price: number) => ((price - lo) / span) * 100;
  const renderKey = markers.map((m) => `${m.key}:${m.price}`).join("|");

  useGSAP(
    () => {
      const rail = root.current;
      if (!rail) return;
      layoutLabels(rail);
      const targets: { key: string; el: HTMLElement | null; vars: gsap.TweenVars }[] = [
        ...markers.map((m) => ({
          key: m.key,
          el: rail.querySelector<HTMLElement>(`[data-marker="${m.key}"]`),
          vars: { left: `${toPct(m.price)}%` },
        })),
        ...zones.map((z) => ({
          key: z.key,
          el: rail.querySelector<HTMLElement>(`[data-zone="${z.key}"]`),
          vars: {
            left: `${toPct(Math.min(z.from, z.to))}%`,
            width: `${(Math.abs(z.to - z.from) / span) * 100}%`,
          },
        })),
      ];
      for (const { key, el, vars } of targets) {
        if (!el) continue;
        if (!placed.current.has(key) || reduced.current) {
          gsap.set(el, vars);
        } else {
          gsap.to(el, { ...vars, ...MOTION, overwrite: "auto" });
        }
      }
      placed.current = new Set(targets.map((t) => t.key));
    },
    { dependencies: [renderKey], scope: root },
  );

  // Label widths are fixed in px while positions are relative: re-stack lanes when the rail width changes,
  // and once the web font has replaced the fallback (different label widths).
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
    let active = true;
    void document.fonts.ready.then(() => {
      if (active) layoutLabels(rail);
    });
    return () => {
      active = false;
      observer.disconnect();
    };
  }, []);

  const description = [...markers]
    .sort((a, b) => a.price - b.price)
    .map((m) => `${m.label} ${formatDe(m.price, 1)}`)
    .join(", ");

  return (
    <div className="rail" ref={root} role="img" aria-label={`Preisleiste (USD, aufsteigend): ${description}`}>
      <div className="rail__track" aria-hidden="true" />
      {zones.map((zone) => (
        <div key={zone.key} className={`rail__zone rail__zone--${zone.key}`} data-zone={zone.key} aria-hidden="true" />
      ))}
      {markers.map((marker) => (
        <div
          key={marker.key}
          className={`rail__marker rail__marker--${marker.key}`}
          data-marker={marker.key}
          data-pos={toPct(marker.price)}
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
