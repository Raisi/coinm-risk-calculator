import { describe, expect, it } from "vitest";
import { crvFromPrices, tpOnTickForCrv, type Direction } from "./calc";
import { DEFAULT_INPUTS, type RawInputs } from "./evaluate";
import {
  applyInputPatch,
  DEFAULT_CRV,
  INITIAL_FORM_STATE,
  TP_DECIMALS,
  tpInputForCrv,
  type FormState,
} from "./form";
import { parseNumber, toPlainDecimal } from "./format";

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

/** Expected auto TP via the calc primitive, independent of `tpInputForCrv`. */
function expectedTp(direction: Direction, entry: number, stop: number): string {
  const tp = tpOnTickForCrv(direction, entry, stop, 2, 1);
  if (tp === null) throw new Error(`no TP for ${direction} ${entry}/${stop}`);
  return toPlainDecimal(tp, 1);
}

/** The true CRV-2 price lies within half a tick of `tp`, so CRV 2 is bracketed by tp ± 0.05. */
function expectCrv2WithinTick(direction: Direction, entry: number, stop: number, tpInput: string): void {
  const tp = parseNumber(tpInput);
  expect(tp).not.toBeNull();
  const crv = crvFromPrices(direction, entry, stop, tp as number);
  expect(crv).not.toBeNull();
  expect(crv as number).toBeCloseTo(2, 2);
  // CRV rises with the distance from entry: long upwards, short downwards.
  const towardEntry = direction === "long" ? (tp as number) - 0.05 : (tp as number) + 0.05;
  const awayFromEntry = direction === "long" ? (tp as number) + 0.05 : (tp as number) - 0.05;
  expect(crvFromPrices(direction, entry, stop, towardEntry) as number).toBeLessThanOrEqual(2);
  expect(crvFromPrices(direction, entry, stop, awayFromEntry) as number).toBeGreaterThanOrEqual(2);
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

describe("constants", () => {
  it("fills TP for CRV 2 on the 0.1 USD tick", () => {
    expect(DEFAULT_CRV).toBe(2);
    expect(TP_DECIMALS).toBe(1);
  });
});

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
    expect(final.inputs.tp).toBe(expectedTp("long", 108000, 105500));
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
    expect(tps).toEqual([
      expectedTp("short", 1, 1000),
      expectedTp("short", 10, 1000),
      expectedTp("short", 100, 1000),
    ]);
    expect(tps).toEqual(["0.3", "3.4", "35.7"]);
    expect(final.tpAuto).toBe(true);

    // Editing a valid stop again moves TP with it, and back to "" when it becomes unusable.
    const long = autoState("long", "108000", "105500");
    const moved = applyInputPatch(long, { stop: "106000" });
    expect(moved.inputs.tp).toBe(expectedTp("long", 108000, 106000));
    expect(moved.inputs.tp).toBe("112235.3");
    expectCrv2WithinTick("long", 108000, 106000, moved.inputs.tp);
    const backspaced = applyInputPatch(moved, { stop: "10600" });
    expect(backspaced.inputs.tp).toBe("");
    const retyped = applyInputPatch(backspaced, { stop: "105505" });
    expect(retyped.inputs.tp).toBe(expectedTp("long", 108000, 105505));
    expect(retyped.tpAuto).toBe(true);
  });

  it("short: entry and stop typed char by char fill TP below entry for CRV 2", () => {
    const start = applyInputPatch(INITIAL_FORM_STATE, { direction: "short" });
    expect(start.inputs.tp).toBe("");
    const withEntry = applyAll(start, typed("entry", "108000"));
    const { final, tps } = tpTrace(withEntry, typed("stop", "110500"));
    // "1".."11050" are below entry: wrong side for a short.
    expect(tps.slice(0, -1)).toEqual(["", "", "", "", ""]);
    expect(final.inputs.tp).toBe(expectedTp("short", 108000, 110500));
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
      tp: expectedTpForCrv3(),
    },
    { name: "cleared", patches: () => [{ tp: "" }], tp: "" },
    { name: "same value as the auto TP", patches: () => [{ tp: "113373.1" }], tp: "113373.1" },
    { name: "unparsable text", patches: () => [{ tp: "abc" }], tp: "abc" },
  ];

  function expectedTpForCrv3(): string {
    const tp = tpOnTickForCrv("long", 108000, 105500, 3, 1);
    if (tp === null) throw new Error("no CRV 3 TP");
    return toPlainDecimal(tp, 1);
  }

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

  // Raw form strings; the 1e22 trade is written out because parseNumber rejects exponent notation.
  const cases: { direction: Direction; entry: string; stop: string; crv: number }[] = [
    { direction: "long", entry: "108000", stop: "105500", crv: 2 },
    { direction: "long", entry: "108000", stop: "105500", crv: 3 },
    { direction: "long", entry: "108000", stop: "106000", crv: 2 },
    { direction: "long", entry: "81005.9", stop: "79205.2", crv: 2.06 },
    { direction: "short", entry: "108000", stop: "110500", crv: 2 },
    { direction: "short", entry: "108000", stop: "110500", crv: 0.5 },
    { direction: "short", entry: "1", stop: "1000", crv: 2 },
    { direction: "short", entry: "0.2", stop: "1", crv: 2 },
    { direction: "short", entry: "10000000000000000000000", stop: "20000000000000000000000", crv: 2 },
  ];

  for (const { direction, entry, stop, crv } of cases) {
    it(`${direction} ${entry}/${stop} CRV ${crv}: plain tick decimal equal to tpOnTickForCrv`, () => {
      const out = tpInputForCrv({ direction, entry, stop }, crv);
      const onTick = tpOnTickForCrv(direction, Number(entry), Number(stop), crv, 1);
      expect(onTick).not.toBeNull();
      expect(out).toBe(toPlainDecimal(onTick as number, 1));
      expect(out as string).toMatch(PLAIN_TICK);
      expect(parseNumber(out as string)).toBe(onTick);
    });
  }

  it("gives the known values for the spec trades", () => {
    expect(tpInputForCrv(valid, 2)).toBe("113373.1");
    expect(tpInputForCrv({ direction: "short", entry: "108000", stop: "110500" }, 2)).toBe("103324.7");
    expect(tpInputForCrv({ direction: "short", entry: "0.2", stop: "1" }, 2)).toBe("0.1");
    expect(
      tpInputForCrv({ direction: "short", entry: "10000000000000000000000", stop: "20000000000000000000000" }, 2),
    ).toBe("5000000000000000000000");
  });

  it("parses German and padded input like the form does", () => {
    expect(tpInputForCrv({ direction: "long", entry: "108.000,0", stop: "105.500,0" }, 2)).toBe("113373.1");
    expect(tpInputForCrv({ direction: "long", entry: " 108 000 ", stop: "105500" }, 2)).toBe("113373.1");
  });

  it("drops a trailing .0 when the tick price is whole", () => {
    // Search a small grid for a short whose CRV-2 price lands on a whole number.
    let found: string | null = null;
    for (let stop = 101; stop <= 400 && found === null; stop++) {
      const out = tpInputForCrv({ direction: "short", entry: "100", stop: String(stop) }, 2);
      const tp = tpOnTickForCrv("short", 100, stop, 2, 1);
      if (out !== null && tp !== null && Number.isInteger(tp)) found = out;
    }
    expect(found).not.toBeNull();
    expect(found as string).toMatch(/^\d+$/);
  });
});
