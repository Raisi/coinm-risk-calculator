import { describe, expect, it } from "vitest";
import type { BalanceField, BalanceRate } from "./balanceLink";
import { crvFromPrices, type Direction } from "./calc";
import { DEFAULT_INPUTS, type RawInputs } from "./evaluate";
import {
  crvUnreachableText,
  DEFAULT_CRV,
  formReducer,
  INITIAL_FORM_STATE,
  tpInputForCrv,
  tpInputForCrvText,
  TEXT_CRV_OFF_TICK,
  type CrvTextResult,
  type FormAction,
  type FormState,
} from "./form";
import { parseNumber } from "./format";

/** Plain dot decimal on the 0.1 tick: no grouping, no exponent, no trailing ".0". */
const PLAIN_TICK = /^(0|[1-9]\d*)(\.\d)?$/;

/** Raw inputs a CRV-derived TP depends on. */
type CrvInputs = Pick<RawInputs, "crvBasis" | "direction" | "entry" | "stop">;

function patch(fields: Partial<RawInputs>): FormAction {
  return { type: "patch", patch: fields };
}

function setCrv(crv: number): FormAction {
  return { type: "crv", crv };
}

/** Dispatches the actions in order, as successive keystrokes / UI events would. */
function run(state: FormState, actions: FormAction[]): FormState {
  return actions.reduce(formReducer, state);
}

/** One patch per prefix of `value`, i.e. typing it character by character. */
function typed(field: "entry" | "stop" | "tp" | BalanceField, value: string): FormAction[] {
  return Array.from({ length: value.length }, (_, i) => patch({ [field]: value.slice(0, i + 1) }));
}

/** Like `run`, but records the TP after every action. */
function tpTrace(state: FormState, actions: FormAction[]): { final: FormState; tps: string[] } {
  const tps: string[] = [];
  let current = state;
  for (const action of actions) {
    current = formReducer(current, action);
    tps.push(current.inputs.tp);
  }
  return { final: current, tps };
}

/** Direction/entry/stop set from the initial state: CRV target 2, TP filled for it when reachable. */
function trade(direction: Direction, entry: string, stop: string): FormState {
  return run(INITIAL_FORM_STATE, [patch({ direction }), patch({ entry }), patch({ stop })]);
}

/** `trade` followed by a typed TP: TP target. */
function tpModeTrade(direction: Direction, entry: string, stop: string, tp: string): FormState {
  return formReducer(trade(direction, entry, stop), patch({ tp }));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Balance link of a state where no balance was typed and no live price fetched. */
const UNLINKED = { balanceSource: null, balanceRate: null } as const;

/** Balance source after a patch carrying exactly one balance field from a state without one. */
function balanceSourceAfter(fields: Partial<RawInputs>): BalanceField | null {
  if (fields.balance !== undefined && fields.balanceUsdt === undefined) return "balance";
  if (fields.balanceUsdt !== undefined && fields.balance === undefined) return "balanceUsdt";
  return null;
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
  const crvToward = crvFromPrices("btc", direction, entry, stop, towardEntry);
  const crvAway = crvFromPrices("btc", direction, entry, stop, awayFromEntry);
  // Toward entry may fall onto/through entry, where no CRV exists: that is below any positive target.
  if (crvToward !== null) expect(crvToward).toBeLessThanOrEqual(crv);
  expect(crvAway).not.toBeNull();
  expect(crvAway as number).toBeGreaterThanOrEqual(crv);
}

const NON_TRADE_PATCHES: Partial<RawInputs>[] = [
  { balance: "0.5" },
  { balance: "" },
  { riskPct: "1" },
  { riskPct: "abc" },
  { leverage: "25" },
  { mmr: "0.01" },
  { riskMode: "amount" },
  { riskMode: "pct" },
  { riskBtc: "0.0001" },
  { riskLimitPct: "3" },
  { bufferPct: "0" },
  { safetyFactor: "3" },
  { nearFactor: "2" },
  { panelLiq: "90000" },
  { account: "usdt" },
  { account: "btc" },
  { balanceUsdt: "1000" },
  { riskUsdt: "25" },
  { tpPlan: "partial" },
  { tpPlan: "ladder" },
  { tp1Crv: "1.5" },
  { tp2Share: "40" },
  { tp3Crv: "" },
];

// Expected TPs below come from exact rational arithmetic, rounded to the nearest 0.1 USD:
//   long  tp = 1 / (1/entry − crv·(1/stop − 1/entry))
//   short tp = 1 / (1/entry + crv·(1/entry − 1/stop))
// A long CRV is reachable only below stop / (entry − stop); a short one always (above the 0.1 tick).

describe("INITIAL_FORM_STATE", () => {
  it("starts with the default inputs, an empty TP and a CRV-2 target", () => {
    expect(DEFAULT_CRV).toBe(2);
    expect(INITIAL_FORM_STATE).toEqual({ inputs: DEFAULT_INPUTS, target: { kind: "crv", crv: 2 }, ...UNLINKED });
    expect(INITIAL_FORM_STATE.inputs.tp).toBe("");
  });
});

describe("formReducer – CRV target follows entry/stop", () => {
  it("long: entry then stop typed char by char fills TP for CRV 2 once reachable", () => {
    const entry = tpTrace(INITIAL_FORM_STATE, typed("entry", "108000"));
    // No stop yet: nothing to derive TP from.
    expect(entry.tps).toEqual(["", "", "", "", "", ""]);
    expect(entry.final.target).toEqual({ kind: "crv", crv: 2 });

    const stop = tpTrace(entry.final, typed("stop", "105500"));
    // "1".."10550": stop / (entry − stop) ≤ 0.11 < 2, so no TP reaches CRV 2.
    // "105500": exact 113373.134…
    expect(stop.tps).toEqual(["", "", "", "", "", "113373.1"]);
    expect(stop.final).toEqual({
      inputs: { ...DEFAULT_INPUTS, entry: "108000", stop: "105500", tp: "113373.1" },
      target: { kind: "crv", crv: 2 },
      ...UNLINKED,
    });
  });

  it("long: stop typed first, then entry; wrong-side intermediates give an empty TP", () => {
    const stop = run(INITIAL_FORM_STATE, typed("stop", "105500"));
    expect(stop.inputs.tp).toBe("");
    expect(stop.target).toEqual({ kind: "crv", crv: 2 });

    const { final, tps } = tpTrace(stop, typed("entry", "108000"));
    // "1".."10800" are below the stop: wrong side for a long.
    expect(tps).toEqual(["", "", "", "", "", "113373.1"]);
    expect(final.target).toEqual({ kind: "crv", crv: 2 });
  });

  it("recomputes on every entry/stop change, not only on the first valid one", () => {
    // Short with the stop set first: every entry prefix 1, 10, 100 is a valid trade.
    // Exact 0.33355…, 3.3557…, 35.714…
    const start = run(INITIAL_FORM_STATE, [patch({ direction: "short" }), patch({ stop: "1000" })]);
    expect(tpTrace(start, typed("entry", "100")).tps).toEqual(["0.3", "3.4", "35.7"]);

    // Exact 112235.294…, then "" (stop 10600 has no CRV-2 price), then exact 113361.587…
    const { final, tps } = tpTrace(trade("long", "108000", "105500"), [
      patch({ stop: "106000" }),
      patch({ stop: "10600" }),
      patch({ stop: "105505" }),
    ]);
    expect(tps).toEqual(["112235.3", "", "113361.6"]);
    expect(final.target).toEqual({ kind: "crv", crv: 2 });
  });

  it("short: entry and stop typed char by char fill TP below entry for CRV 2", () => {
    const withEntry = run(INITIAL_FORM_STATE, [patch({ direction: "short" }), ...typed("entry", "108000")]);
    expect(withEntry.inputs.tp).toBe("");
    const { final, tps } = tpTrace(withEntry, typed("stop", "110500"));
    // "1".."11050" are below entry: wrong side for a short. "110500": exact 103324.675…
    expect(tps).toEqual(["", "", "", "", "", "103324.7"]);
    expect(final.target).toEqual({ kind: "crv", crv: 2 });
  });

  it("CRV 3 sets TP and becomes the target; a stop change recomputes for 3", () => {
    const base = trade("long", "108000", "105500");
    expect(base.inputs.tp).toBe("113373.1");

    // Exact 116265.306…
    const crv3 = formReducer(base, setCrv(3));
    expect(crv3).toEqual({ inputs: { ...base.inputs, tp: "116265.3" }, target: { kind: "crv", crv: 3 }, ...UNLINKED });

    // 1 / (4/108000 − 3/106000) = 114480 exactly: no trailing ".0".
    const moved = formReducer(crv3, patch({ stop: "106000" }));
    expect(moved).toEqual({
      inputs: { ...base.inputs, stop: "106000", tp: "114480" },
      target: { kind: "crv", crv: 3 },
      ...UNLINKED,
    });
  });

  it("CRV 4 on 108000/106000, then stop 105000 recomputes for 4", () => {
    // Exact 116816.326…, then exact 121935.483…
    const { final, tps } = tpTrace(trade("long", "108000", "106000"), [setCrv(4), patch({ stop: "105000" })]);
    expect(tps).toEqual(["116816.3", "121935.5"]);
    expect(final.target).toEqual({ kind: "crv", crv: 4 });
  });

  it("short 108000/111000 CRV 3 gives 99900", () => {
    // 1 / (4/108000 − 3/111000) = 99900 exactly.
    const state = formReducer(trade("short", "108000", "111000"), setCrv(3));
    expect(state.inputs.tp).toBe("99900");
    expect(state.target).toEqual({ kind: "crv", crv: 3 });
  });

  it("a CRV just below the long bound is still reachable", () => {
    // Bound 105500 / 2500 = 42.2; CRV 42.19: exact 455760000.
    const state = formReducer(trade("long", "108000", "105500"), setCrv(42.19));
    expect(state.inputs.tp).toBe("455760000");
    expect(state.target).toEqual({ kind: "crv", crv: 42.19 });
  });

  it("a reachable CRV action overwrites a stale TP", () => {
    const stale: FormState = {
      inputs: { ...DEFAULT_INPUTS, entry: "108000", stop: "105500", tp: "999" },
      target: { kind: "crv", crv: 2 },
      ...UNLINKED,
    };
    expect(formReducer(stale, setCrv(2)).inputs.tp).toBe("113373.1");
    // Re-sending the current direction is an entry/stop/direction change: recomputes too.
    expect(formReducer(stale, patch({ direction: "long" })).inputs.tp).toBe("113373.1");
  });

  it("accepts German-formatted entry/stop and writes TP as a plain dot decimal", () => {
    const state = trade("long", "108.000,0", "105.500");
    // "105.500" without a comma is the dot decimal 105.5: no CRV-2 price.
    expect(state.inputs.tp).toBe("");
    expect(formReducer(state, patch({ stop: "105.500,0" })).inputs.tp).toBe("113373.1");
  });
});

describe("formReducer – unreachable CRV target is kept and refills", () => {
  it("long 100/80 CRV 3 → stop 70 empties TP, a later feasible stop refills it for 3", () => {
    // 1 / (4/100 − 3/80) = 400 exactly.
    const crv3 = formReducer(trade("long", "100", "80"), setCrv(3));
    expect(crv3.inputs.tp).toBe("400");
    expect(crv3.target).toEqual({ kind: "crv", crv: 3 });

    // 100/70: bound 70/30 = 7/3 < 3. 100/90: 1 / (4/100 − 3/90) = 150 exactly.
    const { final, tps } = tpTrace(crv3, [
      patch({ stop: "70" }),
      patch({ entry: "" }),
      patch({ entry: "100" }),
      patch({ stop: "90" }),
    ]);
    expect(tps).toEqual(["", "", "", "150"]);
    expect(final.target).toEqual({ kind: "crv", crv: 3 });
  });

  it("the default target 2 waits on infeasible trades and fills once feasible", () => {
    // 100/60: bound 1.5 < 2; 90/60: exactly at the bound 2.
    expect(trade("long", "100", "60").inputs.tp).toBe("");
    expect(trade("long", "90", "60").inputs.tp).toBe("");
    // 100/70: 1 / (3/100 − 2/70) = 700 exactly.
    const filled = run(trade("long", "100", "60"), [patch({ stop: "70" })]);
    expect(filled.inputs.tp).toBe("700");
    expect(filled.target).toEqual({ kind: "crv", crv: 2 });
  });

  it.each<[string, Partial<RawInputs>]>([
    ["empty entry", { entry: "" }],
    ["empty stop", { stop: "" }],
    ["unparsable stop", { stop: "abc" }],
    ["exponent entry", { entry: "1e5" }],
    ["stop at entry", { stop: "108000" }],
    ["stop above entry", { stop: "110000" }],
    ["negative stop", { stop: "-105500" }],
    ["stop 0", { stop: "0" }],
  ])("%s empties TP, keeps the CRV target and refills on a usable value", (_, unusable) => {
    const crv3 = formReducer(trade("long", "108000", "105500"), setCrv(3));
    const emptied = formReducer(crv3, patch(unusable));
    expect(emptied.inputs.tp).toBe("");
    expect(emptied.target).toEqual({ kind: "crv", crv: 3 });
    const refilled = formReducer(emptied, patch({ entry: "108000", stop: "105500" }));
    expect(refilled.inputs.tp).toBe("116265.3");
    expect(refilled.target).toEqual({ kind: "crv", crv: 3 });
  });
});

describe("formReducer – direction switch", () => {
  it("CRV target: recomputes TP, empty while the stop is on the wrong side", () => {
    const short = formReducer(trade("short", "108000", "111000"), setCrv(3));
    expect(short.inputs.tp).toBe("99900");

    const { final, tps } = tpTrace(short, [
      patch({ direction: "long" }),
      patch({ stop: "106000" }),
      patch({ direction: "short" }),
      patch({ stop: "111000" }),
    ]);
    // long with stop 111000 above entry: "". Long 108000/106000 CRV 3: 114480. Short with stop below: "".
    expect(tps).toEqual(["", "114480", "", "99900"]);
    expect(final.target).toEqual({ kind: "crv", crv: 3 });
    expect(final.inputs.direction).toBe("short");

    const roundTrip = run(trade("long", "108000", "105500"), [
      patch({ direction: "short" }),
      patch({ direction: "long" }),
    ]);
    expect(roundTrip.inputs.tp).toBe("113373.1");
  });

  it("TP target: direction changes keep the typed TP", () => {
    const user = tpModeTrade("long", "108000", "105500", "115000");
    const { final, tps } = tpTrace(user, [
      patch({ direction: "short" }),
      patch({ stop: "110500" }),
      patch({ direction: "long" }),
    ]);
    expect(tps).toEqual(["115000", "115000", "115000"]);
    expect(final.target).toEqual({ kind: "tp" });
  });
});

describe("formReducer – TP typed by the user", () => {
  it("CRV 4 → stop → typed TP 115000 stays → CRV 2.5 takes over again", () => {
    const crv4 = formReducer(trade("long", "108000", "106000"), setCrv(4));
    expect(crv4.inputs.tp).toBe("116816.3");
    const stop105 = formReducer(crv4, patch({ stop: "105000" }));
    expect(stop105.inputs.tp).toBe("121935.5");

    const user = formReducer(stop105, patch({ tp: "115000" }));
    expect(user).toEqual({ inputs: { ...stop105.inputs, tp: "115000" }, target: { kind: "tp" }, ...UNLINKED });

    const kept = tpTrace(user, [patch({ stop: "106000" }), patch({ entry: "109000" }), patch({ entry: "108000" }), patch({ stop: "105000" })]);
    expect(kept.tps).toEqual(["115000", "115000", "115000", "115000"]);
    expect(kept.final.target).toEqual({ kind: "tp" });

    // Exact 116307.692…: back to a CRV target.
    const crv25 = formReducer(kept.final, setCrv(2.5));
    expect(crv25).toEqual({
      inputs: { ...kept.final.inputs, tp: "116307.7" },
      target: { kind: "crv", crv: 2.5 },
      ...UNLINKED,
    });
    // Exact 113346.534…
    const recomputed = formReducer(crv25, patch({ stop: "106000" }));
    expect(recomputed.inputs.tp).toBe("113346.5");
    expect(recomputed.target).toEqual({ kind: "crv", crv: 2.5 });
  });

  const userTpCases: { name: string; actions: FormAction[]; tp: string }[] = [
    { name: "typed char by char", actions: typed("tp", "115000"), tp: "115000" },
    { name: "pasted", actions: [patch({ tp: "115000" })], tp: "115000" },
    { name: "cleared", actions: [patch({ tp: "" })], tp: "" },
    { name: "equal to the current CRV-2 TP", actions: [patch({ tp: "113373.1" })], tp: "113373.1" },
    { name: "unparsable text", actions: [patch({ tp: "abc" })], tp: "abc" },
  ];

  for (const { name, actions, tp } of userTpCases) {
    it(`${name}: TP target, value kept through later entry/stop/direction changes`, () => {
      const user = run(trade("long", "108000", "105500"), actions);
      expect(user.target).toEqual({ kind: "tp" });
      expect(user.inputs.tp).toBe(tp);

      const later = tpTrace(user, [
        ...typed("stop", "106000"),
        patch({ entry: "109000" }),
        patch({ entry: "" }),
        patch({ stop: "100" }),
        patch({ direction: "short" }),
        patch({ stop: "110500" }),
        patch({ entry: "108000" }),
        patch({ direction: "long" }),
        patch({ stop: "105500" }),
      ]);
      expect(later.tps.every((value) => value === tp)).toBe(true);
      expect(later.final.target).toEqual({ kind: "tp" });
      expect(later.final.inputs.entry).toBe("108000");
      expect(later.final.inputs.stop).toBe("105500");
    });
  }

  it("an empty TP equal to the current (unreachable) one also switches to the TP target", () => {
    // Long 100/60: bound 1.5 < 2, TP empty.
    const crv = trade("long", "100", "60");
    expect(crv.inputs.tp).toBe("");
    const user = formReducer(crv, patch({ tp: "" }));
    expect(user.target).toEqual({ kind: "tp" });
    // With the CRV target, stop 70 would fill 700.
    expect(formReducer(user, patch({ stop: "70" })).inputs.tp).toBe("");
  });

  it("works before entry/stop are set: TP set first is kept when entry and stop arrive", () => {
    const user = run(INITIAL_FORM_STATE, [
      patch({ tp: "115000" }),
      ...typed("entry", "108000"),
      ...typed("stop", "105500"),
    ]);
    expect(user).toEqual({
      inputs: { ...DEFAULT_INPUTS, entry: "108000", stop: "105500", tp: "115000" },
      target: { kind: "tp" },
      ...UNLINKED,
    });
  });

  it("a patch carrying tp together with entry/stop/direction keeps the given tp", () => {
    const crv = trade("long", "108000", "105500");
    const user = formReducer(crv, patch({ direction: "short", entry: "109000", stop: "106000", tp: "120000" }));
    expect(user).toEqual({
      inputs: { ...crv.inputs, direction: "short", entry: "109000", stop: "106000", tp: "120000" },
      target: { kind: "tp" },
      ...UNLINKED,
    });
  });

  it("CRV action works from the TP target and makes the CRV the target again", () => {
    const user = tpModeTrade("long", "108000", "105500", "115000");
    const crv3 = formReducer(user, setCrv(3));
    expect(crv3).toEqual({ inputs: { ...user.inputs, tp: "116265.3" }, target: { kind: "crv", crv: 3 }, ...UNLINKED });
    expect(formReducer(crv3, patch({ stop: "106000" })).inputs.tp).toBe("114480");
  });
});

describe("formReducer – invalid or unreachable CRV returns the same state", () => {
  // Long 108000/105500: bound 42.2 (exactly at it is unreachable).
  const badCrvs = [0, -0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 42.2, 50, 1000];

  for (const crv of badCrvs) {
    it(`CRV ${crv} on long 108000/105500 in CRV and TP mode`, () => {
      const crvMode = formReducer(trade("long", "108000", "105500"), setCrv(3));
      expect(formReducer(crvMode, setCrv(crv))).toBe(crvMode);
      const tpMode = tpModeTrade("long", "108000", "105500", "115000");
      expect(formReducer(tpMode, setCrv(crv))).toBe(tpMode);
    });
  }

  const unusable: { name: string; direction: Direction; entry: string; stop: string }[] = [
    { name: "empty entry", direction: "long", entry: "", stop: "105500" },
    { name: "empty stop", direction: "long", entry: "108000", stop: "" },
    { name: "unparsable stop", direction: "long", entry: "108000", stop: "abc" },
    { name: "long stop above entry", direction: "long", entry: "108000", stop: "110000" },
    { name: "long stop at entry", direction: "long", entry: "108000", stop: "108000" },
    { name: "long stop 0", direction: "long", entry: "108000", stop: "0" },
    { name: "short stop below entry", direction: "short", entry: "108000", stop: "105500" },
    // Short 0.1/1: the CRV-2 price 1/28 rounds to 0 on the 0.1 tick.
    { name: "short off the tick", direction: "short", entry: "0.1", stop: "1" },
  ];

  for (const { name, direction, entry, stop } of unusable) {
    it(`${name}: CRV 2 and 3 leave CRV and TP mode untouched`, () => {
      const crvMode = trade(direction, entry, stop);
      expect(crvMode.inputs.tp).toBe("");
      expect(formReducer(crvMode, setCrv(2))).toBe(crvMode);
      expect(formReducer(crvMode, setCrv(3))).toBe(crvMode);
      const tpMode = formReducer(crvMode, patch({ tp: "115000" }));
      expect(formReducer(tpMode, setCrv(2))).toBe(tpMode);
      expect(formReducer(tpMode, setCrv(3))).toBe(tpMode);
    });
  }
});

describe("formReducer – non-trade fields", () => {
  for (const fields of NON_TRADE_PATCHES) {
    const label = JSON.stringify(fields);

    it(`${label} leaves TP and the CRV target alone`, () => {
      const crv3 = formReducer(trade("long", "108000", "105500"), setCrv(3));
      expect(formReducer(crv3, patch(fields))).toEqual({
        inputs: { ...crv3.inputs, ...fields },
        target: { kind: "crv", crv: 3 },
        balanceSource: balanceSourceAfter(fields),
        balanceRate: null,
      });

      // A stale or empty TP is neither recomputed nor filled.
      const stale: FormState = {
        inputs: { ...DEFAULT_INPUTS, entry: "108000", stop: "105500", tp: "999" },
        target: { kind: "crv", crv: 2 },
        ...UNLINKED,
      };
      expect(formReducer(stale, patch(fields)).inputs.tp).toBe("999");
      const empty: FormState = { ...stale, inputs: { ...stale.inputs, tp: "" } };
      expect(formReducer(empty, patch(fields)).inputs.tp).toBe("");
    });

    it(`${label} leaves TP and the TP target alone`, () => {
      const user = tpModeTrade("long", "108000", "105500", "115000");
      expect(formReducer(user, patch(fields))).toEqual({
        inputs: { ...user.inputs, ...fields },
        target: { kind: "tp" },
        balanceSource: balanceSourceAfter(fields),
        balanceRate: null,
      });
    });
  }

  it("the CRV target survives non-trade edits: a later stop change still recomputes", () => {
    const state = run(
      formReducer(trade("long", "108000", "105500"), setCrv(3)),
      NON_TRADE_PATCHES.map((fields) => patch(fields)),
    );
    expect(state.target).toEqual({ kind: "crv", crv: 3 });
    expect(formReducer(state, patch({ stop: "106000" })).inputs.tp).toBe("114480");
  });
});

describe("formReducer – merging and immutability", () => {
  it("only the patched fields change; everything else is kept", () => {
    const base: FormState = {
      inputs: {
        ...DEFAULT_INPUTS,
        balance: "1.5",
        riskMode: "amount",
        riskBtc: "0.01",
        leverage: "20",
        mmr: "0.005",
        panelLiq: "95000",
        entry: "108000",
        stop: "105500",
      },
      target: { kind: "crv", crv: 2 },
      ...UNLINKED,
    };
    const next = formReducer(base, patch({ stop: "106000" }));
    expect(next.inputs).toEqual({ ...base.inputs, stop: "106000", tp: "112235.3" });

    const multi = formReducer(next, patch({ balance: "2", leverage: "5" }));
    expect(multi.inputs).toEqual({ ...next.inputs, balance: "2", leverage: "5" });
  });

  it("an empty patch changes nothing", () => {
    const stale: FormState = {
      inputs: { ...DEFAULT_INPUTS, entry: "108000", stop: "105500", tp: "999" },
      target: { kind: "crv", crv: 2 },
      ...UNLINKED,
    };
    expect(formReducer(stale, patch({}))).toEqual(stale);
    const user = tpModeTrade("long", "108000", "105500", "115000");
    expect(formReducer(user, patch({}))).toEqual(user);
  });

  it("does not mutate the previous state, INITIAL_FORM_STATE or DEFAULT_INPUTS", () => {
    const initialSnapshot = structuredClone(INITIAL_FORM_STATE);
    const defaultsSnapshot = structuredClone(DEFAULT_INPUTS);
    const actions: FormAction[] = [
      patch({ entry: "108000" }),
      patch({ stop: "105500" }),
      setCrv(3),
      patch({ direction: "short" }),
      patch({ tp: "115000" }),
      patch({ balance: "9" }),
      setCrv(50),
      patch({ direction: "long" }),
      setCrv(2.5),
      patch({ stop: "106000" }),
    ];

    const fromInitial = run(INITIAL_FORM_STATE, actions);
    expect(fromInitial).not.toBe(INITIAL_FORM_STATE);
    expect(INITIAL_FORM_STATE).toEqual(initialSnapshot);
    expect(DEFAULT_INPUTS).toEqual(defaultsSnapshot);
    expect(INITIAL_FORM_STATE).toEqual({ inputs: DEFAULT_INPUTS, target: { kind: "crv", crv: 2 }, ...UNLINKED });

    // Every intermediate state is frozen before the next action: any in-place write throws.
    let state = deepFreeze(structuredClone(INITIAL_FORM_STATE));
    for (const action of actions) {
      const snapshot = structuredClone(state);
      const next = formReducer(state, action);
      expect(state).toEqual(snapshot);
      state = deepFreeze(next);
    }
    expect(state).toEqual(fromInitial);
    expect(state).toEqual({
      inputs: { ...DEFAULT_INPUTS, entry: "108000", stop: "106000", tp: "113346.5", balance: "9" },
      target: { kind: "crv", crv: 2.5 },
      // The typed balance became the balance source; without a live price nothing was linked.
      balanceSource: "balance",
      balanceRate: null,
    });
  });
});

describe("tpInputForCrv", () => {
  const valid = { crvBasis: "btc" as const, direction: "long" as const, entry: "108000", stop: "105500" };

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
    expect(tpInputForCrv({ crvBasis: "btc", direction: "short", entry: "108000", stop: "105500" }, 2)).toBeNull();
    expect(tpInputForCrv({ crvBasis: "btc", direction: "short", entry: "108000", stop: "108000" }, 2)).toBeNull();
    expect(tpInputForCrv({ ...valid, stop: "0" }, 2)).toBeNull();
    expect(tpInputForCrv({ ...valid, stop: "-1" }, 2)).toBeNull();
  });

  it("is null when no price reaches the CRV", () => {
    expect(tpInputForCrv({ crvBasis: "btc", direction: "long", entry: "100", stop: "60" }, 2)).toBeNull();
    expect(tpInputForCrv({ crvBasis: "btc", direction: "long", entry: "90", stop: "60" }, 2)).toBeNull();
    // Short whose CRV-2 price rounds to 0 on the 0.1 tick: tpForCrv ≈ 0.036.
    expect(tpInputForCrv({ crvBasis: "btc", direction: "short", entry: "0.1", stop: "1" }, 2)).toBeNull();
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
      const out = tpInputForCrv({ crvBasis: "btc", direction, entry, stop }, crv);
      expect(out).toBe(tp);
      expect(out as string).toMatch(PLAIN_TICK);
      expectCrvBracketedByTick(direction, Number(entry), Number(stop), crv, out as string);
    });
  }

  it("parses German and padded input like the form does", () => {
    expect(tpInputForCrv({ crvBasis: "btc", direction: "long", entry: "108.000,0", stop: "105.500,0" }, 2)).toBe("113373.1");
    expect(tpInputForCrv({ crvBasis: "btc", direction: "long", entry: " 108 000 ", stop: "105500" }, 2)).toBe("113373.1");
  });

  it("drops a trailing .0 when the tick price is whole", () => {
    // Short 100/120: exact 75. Short 100/129: exact 68.98…, rounds up to 69.
    expect(tpInputForCrv({ crvBasis: "btc", direction: "short", entry: "100", stop: "120" }, 2)).toBe("75");
    expect(tpInputForCrv({ crvBasis: "btc", direction: "short", entry: "100", stop: "129" }, 2)).toBe("69");
  });
});

describe("tpInputForCrvText", () => {
  const long = { crvBasis: "btc" as const, direction: "long" as const, entry: "108000", stop: "105500" };
  const short = { crvBasis: "btc" as const, direction: "short" as const, entry: "108000", stop: "110500" };
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

  const unusable: { name: string; inputs: CrvInputs }[] = [
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
    expect(tpInputForCrvText({ crvBasis: "btc", direction: "long", entry: "100", stop: "70" }, "2,5")).toEqual({
      error: "CRV nicht erreichbar – max. 2,33 R bei diesem Stop.",
    });
  });

  it("long 100100/100000: max 1000 is shown with grouping", () => {
    expect(tpInputForCrvText({ crvBasis: "btc", direction: "long", entry: "100100", stop: "100000" }, "1000")).toEqual({
      error: "CRV nicht erreichbar – max. 1.000,00 R bei diesem Stop.",
    });
  });

  // Expected TPs from exact rational arithmetic, rounded to the nearest 0.1 USD:
  //   long  tp = 1 / (1/entry − crv·(1/stop − 1/entry))
  //   short tp = 1 / (1/entry + crv·(1/entry − 1/stop))
  const reachable: {
    inputs: CrvInputs;
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
    { inputs: { ...long, entry: "100", stop: "70" }, text: "2.3", expected: { tp: "7000" } },
    // German entry/stop (comma makes dots thousands separators): exact 116265.306…
    { inputs: { ...long, entry: "108.000,0", stop: "105.500,0" }, text: "3", expected: { tp: "116265.3" } },
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
    { inputs: { ...short, entry: "0.1", stop: "1" }, text: "2" },
  ])("$inputs.direction $inputs.entry/$inputs.stop $text: no TP on the 0.1 tick", ({ inputs, text }) => {
    expect(tpInputForCrvText(inputs, text)).toEqual({
      error: "CRV nicht erreichbar – kein TP-Preis auf dem 0,1-USD-Tick.",
    });
  });
});

describe("CRV basis usd", () => {
  /** `trade` with the usd basis selected first. */
  function usdTrade(direction: Direction, entry: string, stop: string): FormState {
    return run(INITIAL_FORM_STATE, [patch({ crvBasis: "usd" }), patch({ direction }), patch({ entry }), patch({ stop })]);
  }

  // usd: tp = entry + crv · (entry − stop).
  it("CRV target: switching the basis keeps the CRV and recomputes TP (108000/105500: 113373.1 <-> 113000)", () => {
    const btc = trade("long", "108000", "105500");
    expect(btc.inputs.tp).toBe("113373.1");

    const usd = formReducer(btc, patch({ crvBasis: "usd" }));
    expect(usd).toEqual({
      inputs: { ...btc.inputs, crvBasis: "usd", tp: "113000" },
      target: { kind: "crv", crv: 2 },
      ...UNLINKED,
    });
    expect(formReducer(usd, patch({ crvBasis: "btc" }))).toEqual(btc);
  });

  it("TP target: switching the basis keeps the typed TP", () => {
    const user = tpModeTrade("long", "108000", "105500", "115000");
    const { final, tps } = tpTrace(user, [patch({ crvBasis: "usd" }), patch({ stop: "106000" }), patch({ crvBasis: "btc" })]);
    expect(tps).toEqual(["115000", "115000", "115000"]);
    expect(final.target).toEqual({ kind: "tp" });
  });

  it("a patch carrying tp together with the basis keeps the given tp", () => {
    const state = formReducer(trade("long", "108000", "105500"), patch({ crvBasis: "usd", tp: "120000" }));
    expect(state.inputs.tp).toBe("120000");
    expect(state.target).toEqual({ kind: "tp" });
  });

  it("switching the basis before entry/stop are set leaves TP empty and keeps the target", () => {
    const state = formReducer(INITIAL_FORM_STATE, patch({ crvBasis: "usd" }));
    expect(state).toEqual({
      inputs: { ...DEFAULT_INPUTS, crvBasis: "usd" },
      target: { kind: "crv", crv: 2 },
      ...UNLINKED,
    });
  });

  it("spreadsheet examples: long 90000/80000 2 R -> 110000, 2,5 R -> 115000; short 108000/110500 2 R -> 103000", () => {
    expect(usdTrade("long", "90000", "80000").inputs.tp).toBe("110000");
    expect(formReducer(usdTrade("long", "90000", "80000"), setCrv(2.5)).inputs.tp).toBe("115000");
    expect(usdTrade("short", "108000", "110500").inputs.tp).toBe("103000");
  });

  it("CRV 3 sets 115500 and a stop change recomputes linearly (106000 -> 114000)", () => {
    const crv3 = formReducer(usdTrade("long", "108000", "105500"), setCrv(3));
    expect(crv3.inputs.tp).toBe("115500");
    expect(crv3.target).toEqual({ kind: "crv", crv: 3 });
    expect(formReducer(crv3, patch({ stop: "106000" })).inputs.tp).toBe("114000");
  });

  it("long has no bound: CRV 50 gives 233000; in the btc basis (bound 42.2) TP empties, the target stays", () => {
    const crv50 = formReducer(usdTrade("long", "108000", "105500"), setCrv(50));
    expect(crv50.inputs.tp).toBe("233000");
    expect(crv50.target).toEqual({ kind: "crv", crv: 50 });

    const { final, tps } = tpTrace(crv50, [patch({ crvBasis: "btc" }), patch({ crvBasis: "usd" })]);
    expect(tps).toEqual(["", "233000"]);
    expect(final.target).toEqual({ kind: "crv", crv: 50 });
  });

  it("short is bounded by entry / (stop − entry): 43.2 for 108000/110500", () => {
    const short = usdTrade("short", "108000", "110500");
    expect(formReducer(short, setCrv(43.2))).toBe(short);
    expect(formReducer(short, setCrv(50))).toBe(short);
    // 108000 − 43 · 2500
    expect(formReducer(short, setCrv(43)).inputs.tp).toBe("500");
  });

  it("tpInputForCrv usd: linear prices on the tick", () => {
    const usd = { crvBasis: "usd" as const };
    expect(tpInputForCrv({ ...usd, direction: "long", entry: "90000", stop: "80000" }, 2)).toBe("110000");
    expect(tpInputForCrv({ ...usd, direction: "long", entry: "108000", stop: "105500" }, 2)).toBe("113000");
    expect(tpInputForCrv({ ...usd, direction: "short", entry: "108000", stop: "110500" }, 2)).toBe("103000");
    // 81005.9 + 1.921919 · 1800.7 = 84466.6995…
    expect(tpInputForCrv({ ...usd, direction: "long", entry: "81005.9", stop: "79205.2" }, 1.921919)).toBe("84466.7");
    expect(tpInputForCrv({ ...usd, direction: "short", entry: "108000", stop: "110500" }, 43.2)).toBeNull();
    expect(tpInputForCrv({ ...usd, direction: "long", entry: "108000", stop: "110500" }, 2)).toBeNull();
  });

  it("tpInputForCrvText usd: short above the bound shows max 43,20 R, long is unbounded", () => {
    const short = { crvBasis: "usd" as const, direction: "short" as const, entry: "108000", stop: "110500" };
    const long = { crvBasis: "usd" as const, direction: "long" as const, entry: "108000", stop: "105500" };
    expect(tpInputForCrvText(short, "50")).toEqual({ error: crvUnreachableText(43.2) });
    expect(tpInputForCrvText(short, "43,2")).toEqual({ error: crvUnreachableText(43.2) });
    expect(crvUnreachableText(43.2)).toBe("CRV nicht erreichbar – max. 43,20 R bei diesem Stop.");
    expect(tpInputForCrvText(short, "43")).toEqual({ tp: "500" });
    expect(tpInputForCrvText(long, "50")).toEqual({ tp: "233000" });
    expect(tpInputForCrvText(long, "2,5")).toEqual({ tp: "114250" });
  });

  it("tpInputForCrvText usd: a price rounding onto entry has no tick (short 0.3/0.31, 1 R)", () => {
    const inputs = { crvBasis: "usd" as const, direction: "short" as const, entry: "0.3", stop: "0.31" };
    expect(tpInputForCrvText(inputs, "1")).toEqual({ error: TEXT_CRV_OFF_TICK });
    expect(tpInputForCrvText(inputs, "10")).toEqual({ tp: "0.2" });
  });
});

describe("formReducer – Kontostand BTC ↔ USDT link", () => {
  // Expected conversions at 81774.3 USDT per BTC, always rounded DOWN (truncated):
  //   BTC → USDT, 2 decimals: 0.5 → 40887.15; 0.12 → 9812.916 → 9812.91; 0.123456 → 10095.5279808 → 10095.52
  //   USDT → BTC, 8 decimals: 1000 → 0.0122287809… → 0.01222878; 50000 → 0.6114390462… → 0.61143904
  // Converting a derived value back is lossy: 0.01222878 BTC → 999.99 USDT, 10095.52 USDT → 0.1234559 BTC.
  const PRICE = 81774.3;
  const RATE_TIME = new Date(2026, 9, 22, 11, 55, 8).getTime();

  function rate(price: number): BalanceRate {
    return { price, time: RATE_TIME };
  }

  function setRate(price: number): FormAction {
    return { type: "balanceRate", rate: rate(price) };
  }

  /** Initial state after a fetched live price of 81774.3. */
  function priced(): FormState {
    return formReducer(INITIAL_FORM_STATE, setRate(PRICE));
  }

  /** Like `run`, but records [BTC, USDT] after every action. */
  function balanceTrace(state: FormState, actions: FormAction[]): { final: FormState; pairs: [string, string][] } {
    const pairs: [string, string][] = [];
    let current = state;
    for (const action of actions) {
      current = formReducer(current, action);
      pairs.push([current.inputs.balance, current.inputs.balanceUsdt]);
    }
    return { final: current, pairs };
  }

  function balances(state: FormState): Pick<FormState, "balanceSource" | "balanceRate"> & Pick<RawInputs, BalanceField> {
    return {
      balance: state.inputs.balance,
      balanceUsdt: state.inputs.balanceUsdt,
      balanceSource: state.balanceSource,
      balanceRate: state.balanceRate,
    };
  }

  it("typing BTC with a rate derives USDT on every keystroke and keeps the typed BTC text", () => {
    const { final, pairs } = balanceTrace(priced(), typed("balance", "0.123456"));
    expect(pairs).toEqual([
      ["0", ""],
      ["0.", ""],
      ["0.1", "8177.43"],
      ["0.12", "9812.91"],
      ["0.123", "10058.23"],
      ["0.1234", "10090.94"],
      ["0.12345", "10095.03"],
      ["0.123456", "10095.52"],
    ]);
    expect(final.balanceSource).toBe("balance");
    expect(final.balanceRate).toEqual(rate(PRICE));
  });

  it("typing USDT with a rate derives BTC on every keystroke and keeps the typed USDT text", () => {
    const { final, pairs } = balanceTrace(priced(), typed("balanceUsdt", "50000"));
    expect(pairs).toEqual([
      ["0.00006114", "5"],
      ["0.00061143", "50"],
      ["0.00611439", "500"],
      ["0.0611439", "5000"],
      ["0.61143904", "50000"],
    ]);
    expect(final.balanceSource).toBe("balanceUsdt");
  });

  it("German input is linked and kept verbatim", () => {
    const { final, pairs } = balanceTrace(priced(), typed("balance", "0,5"));
    expect(pairs).toEqual([
      ["0", ""],
      ["0,", ""],
      ["0,5", "40887.15"],
    ]);
    const usdt = run(final, typed("balanceUsdt", "1.000,00"));
    expect(usdt.inputs.balanceUsdt).toBe("1.000,00");
    expect(usdt.inputs.balance).toBe("0.01222878");
  });

  it("the typed field is never rewritten from the derived one (no ping-pong, no drift)", () => {
    const usdt = run(priced(), typed("balanceUsdt", "1000"));
    expect(usdt.inputs).toMatchObject({ balance: "0.01222878", balanceUsdt: "1000" });
    const btc = run(priced(), typed("balance", "0.123456"));
    expect(btc.inputs).toMatchObject({ balance: "0.123456", balanceUsdt: "10095.52" });

    // Repeated quotes and unrelated edits leave the pair exactly as it was: nothing converts back.
    const later: FormAction[] = [
      setRate(PRICE),
      patch({ account: "usdt" }),
      setRate(PRICE),
      patch({ entry: "108000" }),
      patch({ stop: "105500" }),
      setCrv(3),
      patch({ tp: "115000" }),
      patch({ account: "btc" }),
      setRate(PRICE),
    ];
    expect(balanceTrace(usdt, later).pairs.every(([b, u]) => b === "0.01222878" && u === "1000")).toBe(true);
    expect(balanceTrace(btc, later).pairs.every(([b, u]) => b === "0.123456" && u === "10095.52")).toBe(true);
  });

  it("without a rate both fields are independent, but the source is still tracked", () => {
    const btc = run(INITIAL_FORM_STATE, typed("balance", "0.5"));
    expect(balances(btc)).toEqual({ balance: "0.5", balanceUsdt: "", balanceSource: "balance", balanceRate: null });

    const both = run(btc, typed("balanceUsdt", "1000"));
    expect(balances(both)).toEqual({ balance: "0.5", balanceUsdt: "1000", balanceSource: "balanceUsdt", balanceRate: null });

    const cleared = formReducer(both, patch({ balance: "" }));
    expect(balances(cleared)).toEqual({ balance: "", balanceUsdt: "1000", balanceSource: "balance", balanceRate: null });
  });

  it("a new rate recomputes the field linked to the BTC source and keeps the BTC text exactly", () => {
    // USDT typed first, then BTC: BTC is the source, USDT an unrelated leftover.
    const typedPair = run(INITIAL_FORM_STATE, [...typed("balanceUsdt", "123"), ...typed("balance", "0,5")]);
    expect(balances(typedPair)).toEqual({ balance: "0,5", balanceUsdt: "123", balanceSource: "balance", balanceRate: null });

    const { final, pairs } = balanceTrace(typedPair, [setRate(PRICE), setRate(90000), setRate(PRICE)]);
    expect(pairs).toEqual([
      ["0,5", "40887.15"],
      ["0,5", "45000"],
      ["0,5", "40887.15"],
    ]);
    expect(final.balanceSource).toBe("balance");
    expect(final.balanceRate).toEqual(rate(PRICE));
  });

  it("a new rate recomputes the field linked to the USDT source and keeps the USDT text exactly", () => {
    // BTC typed first, then USDT: USDT is the source; converting BTC "2" instead would give 163548.6 USDT.
    const typedPair = run(INITIAL_FORM_STATE, [...typed("balance", "2"), ...typed("balanceUsdt", "50000")]);
    const { final, pairs } = balanceTrace(typedPair, [setRate(PRICE), setRate(100000)]);
    expect(pairs).toEqual([
      ["0.61143904", "50000"],
      ["0.5", "50000"],
    ]);
    expect(final.balanceSource).toBe("balanceUsdt");
    expect(final.balanceRate).toEqual(rate(100000));
  });

  it("a rate before any balance was typed only stores the rate", () => {
    const state = priced();
    expect(state).toEqual({ ...INITIAL_FORM_STATE, balanceRate: rate(PRICE) });

    // Values present without a source (e.g. restored) are not converted either.
    const unsourced: FormState = {
      inputs: { ...DEFAULT_INPUTS, balance: "0.5", balanceUsdt: "999" },
      target: { kind: "crv", crv: 2 },
      ...UNLINKED,
    };
    expect(formReducer(unsourced, setRate(PRICE))).toEqual({ ...unsourced, balanceRate: rate(PRICE) });

    // The next keystroke links.
    expect(formReducer(state, patch({ balance: "1" })).inputs.balanceUsdt).toBe("81774.3");
  });

  it("an empty, unparseable or non-positive source empties the derived field", () => {
    const linked = run(priced(), typed("balance", "0.5"));
    expect(linked.inputs.balanceUsdt).toBe("40887.15");
    for (const text of ["", "   ", "abc", "1e5", "0", "0,00", "-1", "-0.5"]) {
      const btc = formReducer(linked, patch({ balance: text }));
      expect(btc.inputs).toMatchObject({ balance: text, balanceUsdt: "" });
      expect(btc.balanceSource).toBe("balance");
      const usdt = formReducer(linked, patch({ balanceUsdt: text }));
      expect(usdt.inputs).toMatchObject({ balance: "", balanceUsdt: text });
      expect(usdt.balanceSource).toBe("balanceUsdt");
    }

    // A rate arriving for an empty source empties the leftover in the other field.
    const emptySource = run(INITIAL_FORM_STATE, [...typed("balanceUsdt", "777"), patch({ balance: "" })]);
    expect(emptySource.inputs.balanceUsdt).toBe("777");
    expect(formReducer(emptySource, setRate(PRICE)).inputs).toMatchObject({ balance: "", balanceUsdt: "" });
  });

  it("switching the account changes neither balance, the source nor the rate", () => {
    const linked = run(priced(), typed("balanceUsdt", "1000"));
    const toggled = tpTrace(linked, [patch({ account: "usdt" }), patch({ account: "btc" }), patch({ account: "usdt" })]);
    expect(balances(toggled.final)).toEqual(balances(linked));
    expect(toggled.final.inputs.account).toBe("usdt");

    // Even a pair that does not match the rate is left alone: only typing or a new rate links.
    const mismatched: FormState = {
      inputs: { ...DEFAULT_INPUTS, balance: "0.5", balanceUsdt: "1" },
      target: { kind: "crv", crv: 2 },
      balanceSource: "balance",
      balanceRate: rate(PRICE),
    };
    for (const account of ["usdt", "btc"] as const) {
      expect(formReducer(mismatched, patch({ account }))).toEqual({
        ...mismatched,
        inputs: { ...mismatched.inputs, account },
      });
    }
  });

  it("balance edits and rates leave TP and the CRV target untouched", () => {
    const crv3 = run(trade("long", "108000", "105500"), [setCrv(3), setRate(PRICE)]);
    expect(crv3.inputs.tp).toBe("116265.3");
    const edited = run(crv3, [...typed("balance", "0.5"), ...typed("balanceUsdt", "1000"), setRate(90000)]);
    expect(edited.inputs).toEqual({ ...crv3.inputs, balance: "0.01111111", balanceUsdt: "1000" });
    expect(edited.target).toEqual({ kind: "crv", crv: 3 });
    // The CRV target still follows the stop afterwards.
    expect(formReducer(edited, patch({ stop: "106000" })).inputs.tp).toBe("114480");
  });

  it("balance edits and rates leave a typed TP and the TP target untouched", () => {
    const user = formReducer(tpModeTrade("long", "108000", "105500", "115000"), setRate(PRICE));
    const edited = run(user, [...typed("balanceUsdt", "1000"), setRate(90000), ...typed("balance", "2")]);
    expect(edited.inputs).toEqual({ ...user.inputs, balance: "2", balanceUsdt: "180000" });
    expect(edited.target).toEqual({ kind: "tp" });
  });

  it("TP, CRV and trade edits leave both balances, the source and the rate untouched", () => {
    const linked = run(priced(), typed("balance", "0.5"));
    const edits: FormAction[] = [
      // Entry is not the conversion price: only the live price links the pair.
      ...typed("entry", "90000"),
      ...typed("stop", "85000"),
      setCrv(3),
      patch({ direction: "short" }),
      patch({ crvBasis: "usd" }),
      ...typed("tp", "80000"),
      patch({ tp: "" }),
      patch({ leverage: "25", riskPct: "1" }),
    ];
    const { final, pairs } = balanceTrace(linked, edits);
    expect(pairs.every(([b, u]) => b === "0.5" && u === "40887.15")).toBe(true);
    expect(final.balanceSource).toBe("balance");
    expect(final.balanceRate).toEqual(rate(PRICE));
  });

  it("a patch carrying both balances keeps both as given and links nothing", () => {
    const linked = run(priced(), typed("balance", "0.5"));
    const both = formReducer(linked, patch({ balance: "2", balanceUsdt: "5" }));
    expect(balances(both)).toEqual({ balance: "2", balanceUsdt: "5", balanceSource: "balance", balanceRate: rate(PRICE) });

    const usdtSource = run(priced(), typed("balanceUsdt", "1000"));
    const bothFromUsdt = formReducer(usdtSource, patch({ balance: "2", balanceUsdt: "5" }));
    expect(balances(bothFromUsdt)).toMatchObject({ balance: "2", balanceUsdt: "5", balanceSource: "balanceUsdt" });

    const fromInitial = formReducer(priced(), patch({ balance: "2", balanceUsdt: "5" }));
    expect(balances(fromInitial)).toMatchObject({ balance: "2", balanceUsdt: "5", balanceSource: null });
  });

  it("the source switches to the field the user types in", () => {
    const btc = run(priced(), typed("balance", "0.5"));
    expect(btc.balanceSource).toBe("balance");

    const { final: usdt, pairs } = balanceTrace(btc, typed("balanceUsdt", "50000"));
    expect(pairs.map(([, u]) => u)).toEqual(["5", "50", "500", "5000", "50000"]);
    expect(usdt.inputs.balance).toBe("0.61143904");
    expect(usdt.balanceSource).toBe("balanceUsdt");
    // A new rate now converts from USDT.
    expect(formReducer(usdt, setRate(100000)).inputs).toMatchObject({ balance: "0.5", balanceUsdt: "50000" });

    const back = run(usdt, typed("balance", "1"));
    expect(balances(back)).toEqual({ balance: "1", balanceUsdt: "81774.3", balanceSource: "balance", balanceRate: rate(PRICE) });
  });

  it("does not mutate states across rate and balance actions", () => {
    const actions: FormAction[] = [
      setRate(PRICE),
      ...typed("balance", "0.5"),
      setRate(90000),
      ...typed("balanceUsdt", "1000"),
      patch({ account: "usdt" }),
      patch({ balance: "2", balanceUsdt: "5" }),
      setRate(PRICE),
    ];
    const initialSnapshot = structuredClone(INITIAL_FORM_STATE);
    let state = deepFreeze(structuredClone(INITIAL_FORM_STATE));
    for (const action of actions) {
      const snapshot = structuredClone(state);
      const next = formReducer(state, action);
      expect(state).toEqual(snapshot);
      state = deepFreeze(next);
    }
    expect(INITIAL_FORM_STATE).toEqual(initialSnapshot);
    // The two-field patch kept USDT as the source, so the last rate converts USDT "5" (5 / 81774.3 = 0.0000611…).
    expect(balances(state)).toEqual({
      balance: "0.00006114",
      balanceUsdt: "5",
      balanceSource: "balanceUsdt",
      balanceRate: rate(PRICE),
    });
  });
});
