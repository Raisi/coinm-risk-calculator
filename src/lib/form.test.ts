import { describe, expect, it } from "vitest";
import { crvFromPrices, type Direction } from "./calc";
import { DEFAULT_INPUTS, type RawInputs } from "./evaluate";
import {
  applyInputPatch,
  crvUnreachableText,
  INITIAL_FORM_STATE,
  tpInputForCrv,
  tpInputForCrvText,
  type CrvTextResult,
  type FormState,
} from "./form";
import { parseNumber } from "./format";

/** Plain dot decimal on the 0.1 tick: no grouping, no exponent, no trailing ".0". */
const PLAIN_TICK = /^(0|[1-9]\d*)(\.\d)?$/;

/** Applies the patches in order, as successive keystrokes / UI events would. */
function applyAll(state: FormState, patches: Partial<RawInputs>[]): FormState {
  return patches.reduce(applyInputPatch, state);
}

/** One patch per prefix of `value`, i.e. typing it character by character. */
function typed(field: "entry" | "stop" | "tp", value: string): Partial<RawInputs>[] {
  return Array.from({ length: value.length }, (_, i) => ({ [field]: value.slice(0, i + 1) }));
}

/** Like `applyAll`, but records the TP after every patch. */
function tpTrace(state: FormState, patches: Partial<RawInputs>[]): { final: FormState; tps: string[] } {
  const tps: string[] = [];
  let current = state;
  for (const patch of patches) {
    current = applyInputPatch(current, patch);
    tps.push(current.inputs.tp);
  }
  return { final: current, tps };
}

/** Auto-mode state with direction/entry/stop set and TP filled for CRV 2. */
function autoState(direction: Direction, entry: string, stop: string): FormState {
  return applyAll(INITIAL_FORM_STATE, [{ direction }, { entry }, { stop }]);
}

/**
 * Tick-aware CRV invariant: the exact price for `crv` lies within half a 0.1 tick of `tpInput`, so the
 * CRV at `tp` ± 0.05 brackets the target. CRV rises with the distance from entry: long upwards, short downwards.
 */
function expectCrvBracketedByTick(
  direction: Direction,
  entry: number,
  stop: number,
  crv: number,
  tpInput: string,
): void {
  const tp = parseNumber(tpInput);
  expect(tp).not.toBeNull();
  const towardEntry = direction === "long" ? (tp as number) - 0.05 : (tp as number) + 0.05;
  const awayFromEntry = direction === "long" ? (tp as number) + 0.05 : (tp as number) - 0.05;
  const crvToward = crvFromPrices(direction, entry, stop, towardEntry);
  const crvAway = crvFromPrices(direction, entry, stop, awayFromEntry);
  // Toward entry may fall onto/through entry, where no CRV exists: that is below any positive target.
  if (crvToward !== null) expect(crvToward).toBeLessThanOrEqual(crv);
  expect(crvAway).not.toBeNull();
  expect(crvAway as number).toBeGreaterThanOrEqual(crv);
}

/** BTC-scale trades: CRV of the tick price is ≈ 2 and CRV 2 is bracketed by tp ± 0.05. */
function expectCrv2WithinTick(direction: Direction, entry: number, stop: number, tpInput: string): void {
  const crv = crvFromPrices(direction, entry, stop, parseNumber(tpInput) as number);
  expect(crv).not.toBeNull();
  expect(crv as number).toBeCloseTo(2, 2);
  expectCrvBracketedByTick(direction, entry, stop, 2, tpInput);
}

const NON_TRADE_PATCHES: Partial<RawInputs>[] = [
  { balance: "0.5" },
  { balance: "" },
  { riskPct: "1" },
  { riskPct: "abc" },
  { leverage: "25" },
  { mmr: "0.01" },
  { riskMode: "btc" },
  { riskMode: "pct" },
  { riskBtc: "0.0001" },
  { riskLimitPct: "3" },
  { bufferPct: "0" },
  { safetyFactor: "3" },
  { nearFactor: "2" },
  { panelLiq: "90000" },
];

describe("INITIAL_FORM_STATE", () => {
  it("starts in auto mode with an empty TP and the default inputs", () => {
    expect(INITIAL_FORM_STATE.tpAuto).toBe(true);
    expect(INITIAL_FORM_STATE.inputs.tp).toBe("");
    expect(INITIAL_FORM_STATE.inputs).toEqual(DEFAULT_INPUTS);
  });
});

describe("applyInputPatch – auto mode", () => {
  it("long: entry then stop typed char by char fills TP for CRV 2 once feasible", () => {
    const entry = tpTrace(INITIAL_FORM_STATE, typed("entry", "108000"));
    // No stop yet: nothing to derive TP from.
    expect(entry.tps).toEqual(["", "", "", "", "", ""]);
    expect(entry.final.tpAuto).toBe(true);

    const stop = tpTrace(entry.final, typed("stop", "105500"));
    // "1".."10550" are below the long bound stop/(entry - stop) > 2: no TP reaches CRV 2.
    expect(stop.tps.slice(0, -1)).toEqual(["", "", "", "", ""]);
    const final = stop.final;
    expect(final.tpAuto).toBe(true);
    expect(final.inputs.entry).toBe("108000");
    expect(final.inputs.stop).toBe("105500");
    expect(final.inputs.tp).toBe("113373.1");
    expectCrv2WithinTick("long", 108000, 105500, final.inputs.tp);
  });

  it("long: stop typed first, then entry; wrong-side intermediates give an empty TP", () => {
    const stop = applyAll(INITIAL_FORM_STATE, typed("stop", "105500"));
    expect(stop.inputs.tp).toBe("");
    expect(stop.tpAuto).toBe(true);

    const { final, tps } = tpTrace(stop, typed("entry", "108000"));
    // "1".."10800" are below the stop: wrong side for a long.
    expect(tps.slice(0, -1)).toEqual(["", "", "", "", ""]);
    expect(final.inputs.tp).toBe("113373.1");
    expect(final.tpAuto).toBe(true);
  });

  it("recomputes on every change, not only on the first valid one", () => {
    // Short with the stop set first: every entry prefix 1, 10, 100 is already a valid trade.
    const start = applyAll(INITIAL_FORM_STATE, [{ direction: "short" }, { stop: "1000" }]);
    const { final, tps } = tpTrace(start, typed("entry", "100"));
    expect(tps).toEqual(["0.3", "3.4", "35.7"]);
    expect(final.tpAuto).toBe(true);

    // Editing a valid stop again moves TP with it, and back to "" when it becomes unusable.
    const long = autoState("long", "108000", "105500");
    const moved = applyInputPatch(long, { stop: "106000" });
    expect(moved.inputs.tp).toBe("112235.3");
    expectCrv2WithinTick("long", 108000, 106000, moved.inputs.tp);
    const backspaced = applyInputPatch(moved, { stop: "10600" });
    expect(backspaced.inputs.tp).toBe("");
    const retyped = applyInputPatch(backspaced, { stop: "105505" });
    expect(retyped.inputs.tp).toBe("113361.6");
    expectCrv2WithinTick("long", 108000, 105505, retyped.inputs.tp);
    expect(retyped.tpAuto).toBe(true);
  });

  it("short: entry and stop typed char by char fill TP below entry for CRV 2", () => {
    const start = applyInputPatch(INITIAL_FORM_STATE, { direction: "short" });
    expect(start.inputs.tp).toBe("");
    const withEntry = applyAll(start, typed("entry", "108000"));
    const { final, tps } = tpTrace(withEntry, typed("stop", "110500"));
    // "1".."11050" are below entry: wrong side for a short.
    expect(tps.slice(0, -1)).toEqual(["", "", "", "", ""]);
    expect(final.inputs.tp).toBe("103324.7");
    expect(final.tpAuto).toBe(true);
    expectCrv2WithinTick("short", 108000, 110500, final.inputs.tp);
  });

  it("direction switch recomputes TP, emptying it when the stop ends up on the wrong side", () => {
    const long = autoState("long", "108000", "105500");
    expect(long.inputs.tp).toBe("113373.1");

    const short = applyInputPatch(long, { direction: "short" });
    expect(short.inputs.direction).toBe("short");
    expect(short.inputs.tp).toBe("");
    expect(short.tpAuto).toBe(true);

    const shortStop = applyInputPatch(short, { stop: "110500" });
    expect(shortStop.inputs.tp).toBe("103324.7");

    const backToLong = applyInputPatch(shortStop, { direction: "long" });
    expect(backToLong.inputs.tp).toBe("");

    const longAgain = applyAll(long, [{ direction: "short" }, { direction: "long" }]);
    expect(longAgain.inputs.tp).toBe("113373.1");
  });

  it("re-sending the current direction still recomputes (no stale TP)", () => {
    const stale: FormState = {
      inputs: { ...DEFAULT_INPUTS, entry: "108000", stop: "105500", tp: "999" },
      tpAuto: true,
    };
    expect(applyInputPatch(stale, { direction: "long" }).inputs.tp).toBe("113373.1");
  });

  it("infeasible long (stop/(entry - stop) <= 2) gives an empty TP", () => {
    expect(autoState("long", "100", "60").inputs.tp).toBe("");
    // Exactly at the bound: 60 / (90 - 60) = 2.
    expect(autoState("long", "90", "60").inputs.tp).toBe("");
    // A feasible TP is replaced by "" when the trade turns infeasible.
    const feasible = autoState("long", "108000", "105500");
    const infeasible = applyAll(feasible, [{ entry: "100" }, { stop: "60" }]);
    expect(infeasible.inputs.tp).toBe("");
    expect(infeasible.tpAuto).toBe(true);
  });

  it("missing, unparsable or wrong-side entry/stop give an empty TP", () => {
    const valid = autoState("long", "108000", "105500");
    expect(applyInputPatch(valid, { entry: "" }).inputs.tp).toBe("");
    expect(applyInputPatch(valid, { stop: "" }).inputs.tp).toBe("");
    expect(applyInputPatch(valid, { stop: "abc" }).inputs.tp).toBe("");
    expect(applyInputPatch(valid, { entry: "1e5" }).inputs.tp).toBe("");
    expect(applyInputPatch(valid, { stop: "108000" }).inputs.tp).toBe("");
    expect(applyInputPatch(valid, { stop: "110000" }).inputs.tp).toBe("");
    expect(applyInputPatch(valid, { stop: "-105500" }).inputs.tp).toBe("");
  });

  it("accepts German-formatted entry/stop and writes TP as a plain dot decimal", () => {
    const state = autoState("long", "108.000,0", "105.500");
    // "105.500" without a comma is the dot decimal 105.5: wrong side.
    expect(state.inputs.tp).toBe("");
    const german = applyInputPatch(state, { stop: "105.500,0" });
    expect(german.inputs.tp).toBe("113373.1");
  });
});

describe("applyInputPatch – TP set by the user", () => {
  const userTpCases: { name: string; patches: (s: FormState) => Partial<RawInputs>[]; tp: string }[] = [
    { name: "typed char by char", patches: () => typed("tp", "115000"), tp: "115000" },
    { name: "pasted", patches: () => [{ tp: "115000" }], tp: "115000" },
    {
      name: "slider value (CRV 3)",
      patches: (s) => [{ tp: tpInputForCrv(s.inputs, 3) as string }],
      tp: "116265.3",
    },
    { name: "cleared", patches: () => [{ tp: "" }], tp: "" },
    { name: "same value as the auto TP", patches: () => [{ tp: "113373.1" }], tp: "113373.1" },
    { name: "unparsable text", patches: () => [{ tp: "abc" }], tp: "abc" },
  ];

  for (const { name, patches, tp } of userTpCases) {
    it(`${name}: switches to user mode, keeps the value through later entry/stop/direction changes`, () => {
      const auto = autoState("long", "108000", "105500");
      const user = applyAll(auto, patches(auto));
      expect(user.tpAuto).toBe(false);
      expect(user.inputs.tp).toBe(tp);

      const later = tpTrace(user, [
        ...typed("stop", "106000"),
        { entry: "109000" },
        { entry: "" },
        { stop: "100" },
        { direction: "short" },
        { stop: "110500" },
        { entry: "108000" },
        { direction: "long" },
        { stop: "105500" },
      ]);
      expect(later.tps.every((value) => value === tp)).toBe(true);
      expect(later.final.tpAuto).toBe(false);
      expect(later.final.inputs.entry).toBe("108000");
      expect(later.final.inputs.stop).toBe("105500");
    });
  }

  it("slider at CRV 3 yields a TP whose CRV is about 3", () => {
    const auto = autoState("long", "108000", "105500");
    const tp = tpInputForCrv(auto.inputs, 3) as string;
    const user = applyInputPatch(auto, { tp });
    expect(user.inputs.tp).not.toBe(auto.inputs.tp);
    expect(crvFromPrices("long", 108000, 105500, parseNumber(user.inputs.tp) as number)).toBeCloseTo(3, 2);
  });

  it("works before entry/stop are set: TP set first is kept when entry and stop arrive", () => {
    const user = applyAll(INITIAL_FORM_STATE, [
      { tp: "115000" },
      ...typed("entry", "108000"),
      ...typed("stop", "105500"),
    ]);
    expect(user.tpAuto).toBe(false);
    expect(user.inputs.tp).toBe("115000");
  });

  it("a patch carrying tp together with entry/stop keeps the given tp", () => {
    const auto = autoState("long", "108000", "105500");
    const user = applyInputPatch(auto, { entry: "109000", stop: "106000", tp: "120000" });
    expect(user).toEqual({ inputs: { ...auto.inputs, entry: "109000", stop: "106000", tp: "120000" }, tpAuto: false });
  });

  it("stays in user mode for good: later TP edits keep it user, never back to auto", () => {
    const user = applyAll(autoState("long", "108000", "105500"), [{ tp: "" }, { tp: "115000" }, { tp: "" }]);
    expect(user.tpAuto).toBe(false);
    expect(user.inputs.tp).toBe("");
    const after = applyAll(user, [{ stop: "106000" }, { direction: "short" }, { direction: "long" }]);
    expect(after.inputs.tp).toBe("");
    expect(after.tpAuto).toBe(false);
  });
});

describe("applyInputPatch – CRV slider/field ownership", () => {
  it("QA repro long 100/70: re-sending the unchanged auto TP hands TP to the user for good", () => {
    // Exact CRV-2 TP: 1 / (1/100 − 2 · (1/70 − 1/100)) = 700.
    const auto = autoState("long", "100", "70");
    expect(auto.inputs.tp).toBe("700");
    expect(auto.tpAuto).toBe(true);

    // Unreachable CRV (e.g. 5 > 7/3): the UI keeps TP and re-sends it to take ownership.
    const owned = applyInputPatch(auto, { tp: auto.inputs.tp });
    expect(owned).toEqual({ inputs: auto.inputs, tpAuto: false });

    // In auto mode stop 60 would clear TP (bound 1.5 < 2); in user mode it stays.
    const stop = applyInputPatch(owned, { stop: "60" });
    expect(stop.inputs.tp).toBe("700");
    expect(stop.tpAuto).toBe(false);
  });

  it("the auto TP would have changed on the same stop edit without the ownership patch", () => {
    const auto = autoState("long", "100", "70");
    expect(applyInputPatch(auto, { stop: "60" }).inputs.tp).toBe("");
  });

  it("unchanged-TP patch keeps TP through later entry/stop/direction edits (long 108000/105500)", () => {
    const auto = autoState("long", "108000", "105500");
    expect(auto.inputs.tp).toBe("113373.1");
    const owned = applyInputPatch(auto, { tp: auto.inputs.tp });
    expect(owned.tpAuto).toBe(false);

    const later = tpTrace(owned, [
      { stop: "106000" },
      { entry: "109000" },
      { direction: "short" },
      { stop: "110500" },
      { direction: "long" },
      { entry: "" },
    ]);
    expect(later.tps).toEqual(["113373.1", "113373.1", "113373.1", "113373.1", "113373.1", "113373.1"]);
    expect(later.final.tpAuto).toBe(false);
  });

  it("unchanged empty TP (no reachable CRV yet) also takes ownership and stays empty", () => {
    // Long 100/60: bound 1.5 < 2, so the auto TP is empty.
    const auto = autoState("long", "100", "60");
    expect(auto.inputs.tp).toBe("");
    const owned = applyInputPatch(auto, { tp: auto.inputs.tp });
    expect(owned.tpAuto).toBe(false);
    // Stop 70 would give auto TP 700; in user mode TP stays empty.
    expect(applyInputPatch(owned, { stop: "70" }).inputs.tp).toBe("");
  });

  it("a typed reachable CRV sets TP via the text helper and switches to user mode", () => {
    const auto = autoState("long", "108000", "105500");
    const result = tpInputForCrvText(auto.inputs, "3");
    expect(result).toEqual({ tp: "116265.3" });
    const user = applyInputPatch(auto, result as { tp: string });
    expect(user.inputs.tp).toBe("116265.3");
    expect(user.tpAuto).toBe(false);
    expect(applyInputPatch(user, { stop: "106000" }).inputs.tp).toBe("116265.3");
  });
});

describe("applyInputPatch – non-trade fields", () => {
  for (const patch of NON_TRADE_PATCHES) {
    const label = JSON.stringify(patch);

    it(`${label} leaves TP and the auto flag alone in auto mode`, () => {
      const auto = autoState("long", "108000", "105500");
      const next = applyInputPatch(auto, patch);
      expect(next.tpAuto).toBe(true);
      expect(next.inputs).toEqual({ ...auto.inputs, ...patch });
      expect(next.inputs.tp).toBe("113373.1");
    });

    it(`${label} does not recompute a TP that differs from CRV 2 in auto mode`, () => {
      const stale: FormState = {
        inputs: { ...DEFAULT_INPUTS, entry: "108000", stop: "105500", tp: "999" },
        tpAuto: true,
      };
      const next = applyInputPatch(stale, patch);
      expect(next.inputs.tp).toBe("999");
      expect(next.tpAuto).toBe(true);
    });

    it(`${label} does not fill an empty TP in auto mode`, () => {
      const empty: FormState = {
        inputs: { ...DEFAULT_INPUTS, entry: "108000", stop: "105500", tp: "" },
        tpAuto: true,
      };
      expect(applyInputPatch(empty, patch).inputs.tp).toBe("");
    });

    it(`${label} leaves TP and the user flag alone in user mode`, () => {
      const user = applyInputPatch(autoState("long", "108000", "105500"), { tp: "115000" });
      const next = applyInputPatch(user, patch);
      expect(next.tpAuto).toBe(false);
      expect(next.inputs).toEqual({ ...user.inputs, ...patch });
    });
  }

  it("auto mode survives non-trade edits: a later stop change still recomputes", () => {
    const state = applyAll(autoState("long", "108000", "105500"), NON_TRADE_PATCHES);
    expect(state.tpAuto).toBe(true);
    expect(applyInputPatch(state, { stop: "106000" }).inputs.tp).toBe("112235.3");
  });
});

describe("applyInputPatch – merging", () => {
  it("only the patched fields change; everything else is kept", () => {
    const base: FormState = {
      inputs: {
        ...DEFAULT_INPUTS,
        balance: "1.5",
        riskMode: "btc",
        riskBtc: "0.01",
        leverage: "20",
        mmr: "0.005",
        panelLiq: "95000",
        entry: "108000",
        stop: "105500",
      },
      tpAuto: true,
    };
    const next = applyInputPatch(base, { stop: "106000" });
    expect(next.inputs).toEqual({ ...base.inputs, stop: "106000", tp: "112235.3" });

    const multi = applyInputPatch(next, { balance: "2", leverage: "5" });
    expect(multi.inputs).toEqual({ ...next.inputs, balance: "2", leverage: "5" });
  });

  it("an empty patch changes nothing", () => {
    const auto = autoState("long", "108000", "105500");
    expect(applyInputPatch(auto, {})).toEqual(auto);
    const user = applyInputPatch(auto, { tp: "115000" });
    expect(applyInputPatch(user, {})).toEqual(user);
  });

  it("does not mutate the previous state or INITIAL_FORM_STATE", () => {
    const initialSnapshot = structuredClone(INITIAL_FORM_STATE);
    const defaultsSnapshot = structuredClone(DEFAULT_INPUTS);
    const auto = autoState("long", "108000", "105500");
    const autoSnapshot = structuredClone(auto);

    const next = applyAll(auto, [{ stop: "106000" }, { tp: "115000" }, { balance: "9" }]);
    expect(next).not.toBe(auto);
    expect(auto).toEqual(autoSnapshot);
    expect(INITIAL_FORM_STATE).toEqual(initialSnapshot);
    expect(DEFAULT_INPUTS).toEqual(defaultsSnapshot);
    expect(INITIAL_FORM_STATE.inputs.tp).toBe("");
    expect(INITIAL_FORM_STATE.tpAuto).toBe(true);
  });
});

describe("tpInputForCrv", () => {
  const valid = { direction: "long" as const, entry: "108000", stop: "105500" };

  it("is null for empty or unparsable entry/stop", () => {
    expect(tpInputForCrv({ ...valid, entry: "" }, 2)).toBeNull();
    expect(tpInputForCrv({ ...valid, stop: "" }, 2)).toBeNull();
    expect(tpInputForCrv({ ...valid, entry: "   " }, 2)).toBeNull();
    expect(tpInputForCrv({ ...valid, entry: "abc" }, 2)).toBeNull();
    expect(tpInputForCrv({ ...valid, stop: "105500x" }, 2)).toBeNull();
    expect(tpInputForCrv({ ...valid, stop: "1e5" }, 2)).toBeNull();
  });

  it("is null for a stop on the wrong side or at entry", () => {
    expect(tpInputForCrv({ ...valid, stop: "110000" }, 2)).toBeNull();
    expect(tpInputForCrv({ ...valid, stop: "108000" }, 2)).toBeNull();
    expect(tpInputForCrv({ direction: "short", entry: "108000", stop: "105500" }, 2)).toBeNull();
    expect(tpInputForCrv({ direction: "short", entry: "108000", stop: "108000" }, 2)).toBeNull();
    expect(tpInputForCrv({ ...valid, stop: "0" }, 2)).toBeNull();
    expect(tpInputForCrv({ ...valid, stop: "-1" }, 2)).toBeNull();
  });

  it("is null when no price reaches the CRV", () => {
    expect(tpInputForCrv({ direction: "long", entry: "100", stop: "60" }, 2)).toBeNull();
    expect(tpInputForCrv({ direction: "long", entry: "90", stop: "60" }, 2)).toBeNull();
    // Short whose CRV-2 price rounds to 0 on the 0.1 tick: tpForCrv ≈ 0.036.
    expect(tpInputForCrv({ direction: "short", entry: "0.1", stop: "1" }, 2)).toBeNull();
    expect(tpInputForCrv(valid, 0)).toBeNull();
    expect(tpInputForCrv(valid, -1)).toBeNull();
    expect(tpInputForCrv(valid, Number.NaN)).toBeNull();
  });

  // Expected TPs from exact rational arithmetic, rounded to the nearest 0.1 USD:
  //   long  tp = 1 / (1/entry − crv·(1/stop − 1/entry))
  //   short tp = 1 / (1/entry + crv·(1/entry − 1/stop))
  // Raw form strings; the 1e22 trade is written out because parseNumber rejects exponent notation.
  const cases: { direction: Direction; entry: string; stop: string; crv: number; tp: string }[] = [
    // exact 113373.134…
    { direction: "long", entry: "108000", stop: "105500", crv: 2, tp: "113373.1" },
    // exact 116265.306…
    { direction: "long", entry: "108000", stop: "105500", crv: 3, tp: "116265.3" },
    // exact 112235.294…: rounds up
    { direction: "long", entry: "108000", stop: "106000", crv: 2, tp: "112235.3" },
    // exact 84986.0797…: rounds up
    { direction: "long", entry: "81005.9", stop: "79205.2", crv: 2.06, tp: "84986.1" },
    // exact 103324.675…
    { direction: "short", entry: "108000", stop: "110500", crv: 2, tp: "103324.7" },
    // exact 106791.946…
    { direction: "short", entry: "108000", stop: "110500", crv: 0.5, tp: "106791.9" },
    // exact 0.33355…
    { direction: "short", entry: "1", stop: "1000", crv: 2, tp: "0.3" },
    // exact 0.0769…: rounds up to the smallest positive tick
    { direction: "short", entry: "0.2", stop: "1", crv: 2, tp: "0.1" },
    // exact 5e21: plain digits, no exponent
    {
      direction: "short",
      entry: "10000000000000000000000",
      stop: "20000000000000000000000",
      crv: 2,
      tp: "5000000000000000000000",
    },
  ];

  for (const { direction, entry, stop, crv, tp } of cases) {
    it(`${direction} ${entry}/${stop} CRV ${crv}: ${tp} as a plain tick decimal`, () => {
      const out = tpInputForCrv({ direction, entry, stop }, crv);
      expect(out).toBe(tp);
      expect(out as string).toMatch(PLAIN_TICK);
      expectCrvBracketedByTick(direction, Number(entry), Number(stop), crv, out as string);
    });
  }

  it("parses German and padded input like the form does", () => {
    expect(tpInputForCrv({ direction: "long", entry: "108.000,0", stop: "105.500,0" }, 2)).toBe("113373.1");
    expect(tpInputForCrv({ direction: "long", entry: " 108 000 ", stop: "105500" }, 2)).toBe("113373.1");
  });

  it("drops a trailing .0 when the tick price is whole", () => {
    // Short 100/120: exact 75. Short 100/129: exact 68.98…, rounds up to 69.
    expect(tpInputForCrv({ direction: "short", entry: "100", stop: "120" }, 2)).toBe("75");
    expect(tpInputForCrv({ direction: "short", entry: "100", stop: "129" }, 2)).toBe("69");
  });
});

describe("tpInputForCrvText", () => {
  const long = { direction: "long" as const, entry: "108000", stop: "105500" };
  const short = { direction: "short" as const, entry: "108000", stop: "110500" };
  const INVALID = "CRV muss größer als 0 sein.";

  it("formats the unreachable error text", () => {
    expect(crvUnreachableText(42.2)).toBe("CRV nicht erreichbar – max. 42,20 R bei diesem Stop.");
    expect(crvUnreachableText(70 / 30)).toBe("CRV nicht erreichbar – max. 2,33 R bei diesem Stop.");
    expect(crvUnreachableText(1000)).toBe("CRV nicht erreichbar – max. 1.000,00 R bei diesem Stop.");
  });

  it.each(["", " ", "   "])("empty draft %j gives no error and no TP", (text) => {
    expect(tpInputForCrvText(long, text)).toEqual({ error: null });
  });

  it.each(["abc", "0", "-1", "0,0", "0.0", "-0", "-2,5", "1e3", "3x", ",", ".", "2,5,1", "Infinity", "NaN"])(
    "unparsable or non-positive %j gives the invalid error",
    (text) => {
      expect(tpInputForCrvText(long, text)).toEqual({ error: INVALID });
      expect(tpInputForCrvText(short, text)).toEqual({ error: INVALID });
    },
  );

  it("invalid text is reported even when entry/stop are unusable", () => {
    expect(tpInputForCrvText({ ...long, entry: "" }, "abc")).toEqual({ error: INVALID });
    expect(tpInputForCrvText({ ...long, stop: "110000" }, "0")).toEqual({ error: INVALID });
  });

  const unusable: { name: string; inputs: Pick<RawInputs, "direction" | "entry" | "stop"> }[] = [
    { name: "empty entry", inputs: { ...long, entry: "" } },
    { name: "empty stop", inputs: { ...long, stop: "" } },
    { name: "unparsable entry", inputs: { ...long, entry: "abc" } },
    { name: "long stop above entry", inputs: { ...long, stop: "110000" } },
    { name: "long stop at entry", inputs: { ...long, stop: "108000" } },
    { name: "long stop 0", inputs: { ...long, stop: "0" } },
    { name: "long negative stop", inputs: { ...long, stop: "-1" } },
    { name: "short stop below entry", inputs: { ...short, stop: "105500" } },
    { name: "short stop at entry", inputs: { ...short, stop: "108000" } },
    { name: "short empty entry", inputs: { ...short, entry: "" } },
  ];

  for (const { name, inputs } of unusable) {
    it(`${name}: a valid CRV gives no error (field disabled)`, () => {
      expect(tpInputForCrvText(inputs, "3")).toEqual({ error: null });
      expect(tpInputForCrvText(inputs, "50")).toEqual({ error: null });
      expect(tpInputForCrvText(inputs, "")).toEqual({ error: null });
    });
  }

  it.each(["50", "42.2", "42,2", "42,20", "1000"])("long 108000/105500 %j at/above max 42.2 is unreachable", (text) => {
    expect(tpInputForCrvText(long, text)).toEqual({
      error: "CRV nicht erreichbar – max. 42,20 R bei diesem Stop.",
    });
  });

  it("long 100/70: CRV 2.5 is above max 7/3", () => {
    expect(tpInputForCrvText({ direction: "long", entry: "100", stop: "70" }, "2,5")).toEqual({
      error: "CRV nicht erreichbar – max. 2,33 R bei diesem Stop.",
    });
  });

  it("long 100100/100000: max 1000 is shown with grouping", () => {
    expect(tpInputForCrvText({ direction: "long", entry: "100100", stop: "100000" }, "1000")).toEqual({
      error: "CRV nicht erreichbar – max. 1.000,00 R bei diesem Stop.",
    });
  });

  // Expected TPs from exact rational arithmetic, rounded to the nearest 0.1 USD:
  //   long  tp = 1 / (1/entry − crv·(1/stop − 1/entry))
  //   short tp = 1 / (1/entry + crv·(1/entry − 1/stop))
  const reachable: {
    inputs: Pick<RawInputs, "direction" | "entry" | "stop">;
    text: string;
    expected: CrvTextResult;
  }[] = [
    // exact 116265.306… (= 108000 + 405000/49)
    { inputs: long, text: "3", expected: { tp: "116265.3" } },
    // exact 114801.0076… (= 108000 + 2700000/397)
    { inputs: long, text: "2,5", expected: { tp: "114801" } },
    { inputs: long, text: "2.5", expected: { tp: "114801" } },
    { inputs: long, text: " 2,5 ", expected: { tp: "114801" } },
    // Draft "2," parses as 2: exact 113373.134…
    { inputs: long, text: "2,", expected: { tp: "113373.1" } },
    { inputs: long, text: "+3", expected: { tp: "116265.3" } },
    // exact 108000.2559… (= 108000 + 108000/421999)
    { inputs: long, text: "0,0001", expected: { tp: "108000.3" } },
    // just below the bound: exact 455760000
    { inputs: long, text: "42,19", expected: { tp: "455760000" } },
    // long 100/70: exact 7000
    { inputs: { direction: "long", entry: "100", stop: "70" }, text: "2.3", expected: { tp: "7000" } },
    // German entry/stop (comma makes dots thousands separators): exact 116265.306…
    { inputs: { direction: "long", entry: "108.000,0", stop: "105.500,0" }, text: "3", expected: { tp: "116265.3" } },
    // Short is unbounded: exact 50675.159… (= 108000 − 9000000/157)
    { inputs: short, text: "50", expected: { tp: "50675.2" } },
    // exact 103324.675…
    { inputs: short, text: "2", expected: { tp: "103324.7" } },
  ];

  for (const { inputs, text, expected } of reachable) {
    it(`${inputs.direction} ${inputs.entry}/${inputs.stop} ${JSON.stringify(text)} gives ${JSON.stringify(expected)}`, () => {
      expect(tpInputForCrvText(inputs, text)).toEqual(expected);
    });
  }

  it.each([
    // exact 108000.0256… (= 108000 + 108000/4219999): rounds onto entry
    { inputs: long, text: "0,00001" },
    { inputs: long, text: "0.00001" },
    // exact 107999.9756… (= 108000 − 108000/4420001): rounds onto entry
    { inputs: short, text: "0.00001" },
    // exact 0.0357… (= 1 / 28): rounds to 0, not a positive price
    { inputs: { direction: "short" as const, entry: "0.1", stop: "1" }, text: "2" },
  ])("$inputs.direction $inputs.entry/$inputs.stop $text: no TP on the 0.1 tick", ({ inputs, text }) => {
    expect(tpInputForCrvText(inputs, text)).toEqual({
      error: "CRV nicht erreichbar – kein TP-Preis auf dem 0,1-USD-Tick.",
    });
  });
});
