import { describe, expect, it } from "vitest";
import {
  DEFAULT_INPUTS,
  evaluate,
  TEXT_LIQ_AT_OR_BEFORE_STOP,
  TEXT_LIQ_NEAR_STOP,
  TEXT_RISK_OVER_LIMIT,
  TEXT_LIQ_NOT_COMPUTABLE,
  TEXT_SIZING_NOT_COMPUTABLE,
  TEXT_STOP_WRONG_SIDE,
  TEXT_TP_WRONG_SIDE,
  toJournalRow,
  type Evaluation,
  type InputError,
  type RawInputs,
} from "./evaluate";
import { buildJournalTsv, COPY_DECIMALS, toCopyValue } from "./format";

function expectRel(actual: number, expected: number, tol: number): void {
  const diff = Math.abs(actual - expected);
  const allowed = tol * Math.abs(expected);
  expect(
    diff <= allowed,
    `expected ${actual} to be within ${tol * 100}% of ${expected} (diff ${diff}, allowed ${allowed})`,
  ).toBe(true);
}

const LIQ_TOL = 0.005;
const POS_TOL = 0.01;

/** Spec base case: Long, balance 0.00725346, entry 81005.9, stop 79205.2, tp 84707.1, buffer 0, m 0.004. */
function inputs(overrides: Partial<RawInputs> = {}): RawInputs {
  return {
    ...DEFAULT_INPUTS,
    balance: "0.00725346",
    riskMode: "pct",
    riskPct: "5",
    riskLimitPct: "10",
    direction: "long",
    entry: "81005.9",
    stop: "79205.2",
    tp: "84707.1",
    leverage: "30",
    bufferPct: "0",
    mmr: "0.004",
    safetyFactor: "2",
    nearFactor: "1.5",
    panelLiq: "",
    ...overrides,
  };
}

function ok(raw: RawInputs): Evaluation {
  const result = evaluate(raw);
  if (!result.ok) throw new Error(`expected ok, got errors: ${JSON.stringify(result.errors)}`);
  return result.value;
}

function errors(raw: RawInputs): InputError[] {
  const result = evaluate(raw);
  if (result.ok) throw new Error("expected errors, got ok result");
  return result.errors;
}

const SHORT_STOP = "82806.6"; // mirrored stop distance for shorts
const SHORT_TP = "77304.7";

describe("acceptance Fall A (5 % risk)", () => {
  it("30x: risk, position value, margin, gain, CRV, effective leverage", () => {
    const e = ok(inputs({ leverage: "30" }));
    expectRel(e.grossRiskBtc, 0.000362673, 1e-9);
    expectRel(e.riskBtc, 0.000362673, 1e-9);
    expectRel(e.riskPctEffective, 5, 1e-9);
    expectRel(e.positionUsd, 1292.2, POS_TOL);
    expectRel(e.positionBtc, 0.01595, POS_TOL);
    expectRel(e.marginBtc, 0.000532, POS_TOL);
    expect(e.gainBtc).not.toBeNull();
    expectRel(e.gainBtc!, 0.000697, POS_TOL);
    expect(e.crv).not.toBeNull();
    expectRel(e.crv!, 1.92, POS_TOL);
    expectRel(e.effectiveLeverage, 2.2, POS_TOL);
    expectRel(e.stopDistancePct, 2.2229, 0.001);
  });

  it("10x: same notional, margin ≈ 0.001595", () => {
    const e30 = ok(inputs({ leverage: "30" }));
    const e10 = ok(inputs({ leverage: "10" }));
    expect(e10.positionUsd).toBe(e30.positionUsd);
    expectRel(e10.marginBtc, 0.001595, POS_TOL);
  });

  it("accepts German formatted inputs with the same result", () => {
    const german = ok(
      inputs({ balance: "0,00725346", entry: "81.005,9", stop: "79.205,2", tp: "84.707,1", mmr: "0,004" }),
    );
    const plain = ok(inputs());
    expect(german.positionUsd).toBe(plain.positionUsd);
    expect(german.liq.price).toBe(plain.liq.price);
  });
});

describe("acceptance Fall B (BTC mode, 0.00035 BTC)", () => {
  it("30x and 10x: position value, margin, gain, CRV, effective leverage", () => {
    const e30 = ok(inputs({ riskMode: "amount", riskBtc: "0.00035", riskPct: "", leverage: "30" }));
    const e10 = ok(inputs({ riskMode: "amount", riskBtc: "0.00035", riskPct: "", leverage: "10" }));
    expect(e30.grossRiskBtc).toBe(0.00035);
    expectRel(e30.riskPctEffective, (0.00035 / 0.00725346) * 100, 1e-9);
    expectRel(e30.positionUsd, 1247.1, POS_TOL);
    expectRel(e30.positionBtc, 0.0154, POS_TOL);
    expectRel(e30.marginBtc, 0.000513, POS_TOL);
    expectRel(e10.marginBtc, 0.00154, POS_TOL);
    expectRel(e30.gainBtc!, 0.000673, POS_TOL);
    expectRel(e30.crv!, 1.92, POS_TOL);
    expectRel(e30.effectiveLeverage, 2.12, POS_TOL);
  });

  it("amount mode ignores an invalid riskPct field", () => {
    const e = ok(inputs({ riskMode: "amount", riskBtc: "0,00035", riskPct: "abc" }));
    expect(e.grossRiskBtc).toBe(0.00035);
  });
});

describe("liquidation classification (computed liq)", () => {
  it("30x long is rot (factor ≈ 1.28, near stop) with a 19x suggestion", () => {
    const e = ok(inputs({ leverage: "30" }));
    expectRel(e.liq.price, 78697.5, LIQ_TOL);
    expectRel(e.liq.factor, 1.28, 0.01);
    expect(e.liq.status).toBe("rot");
    expect(e.liq.text).toBe(TEXT_LIQ_NEAR_STOP);
    expect(e.status).toBe("rot");
    expect(e.compliant).toBe(false);
    expect(e.suggestion).toEqual({ maxLeverage: 19, text: "Vorschlag: max. 19x Hebel" });
    expect(e.warnings).toContainEqual({ source: "liq", status: "rot", text: TEXT_LIQ_NEAR_STOP });
  });

  it("26x long is rot (factor just below the near threshold 1.5)", () => {
    const e = ok(inputs({ leverage: "26" }));
    expect(e.liq.factor).toBeLessThan(1.5);
    expect(e.liq.status).toBe("rot");
    expect(e.compliant).toBe(false);
  });

  it("25x long is gelb and still compliant", () => {
    const e = ok(inputs({ leverage: "25" }));
    expect(e.liq.factor).toBeGreaterThanOrEqual(1.5);
    expect(e.liq.status).toBe("gelb");
    expect(e.status).toBe("gelb");
    expect(e.compliant).toBe(true);
    expect(e.suggestion?.maxLeverage).toBe(19);
  });

  it("20x long is gelb (factor ≈ 1.98) with the 'unter Sicherheitsfaktor' text", () => {
    const e = ok(inputs({ leverage: "20" }));
    expectRel(e.liq.price, 77443.5, LIQ_TOL);
    expectRel(e.liq.factor, 1.98, 0.01);
    expect(e.liq.status).toBe("gelb");
    expect(e.liq.text).toBe("Liq-Abstand unter Sicherheitsfaktor (1,98 statt 2).");
    expect(e.compliant).toBe(true);
  });

  it("19x long is gruen (factor ≈ 2.09), no suggestion, no warnings", () => {
    const e = ok(inputs({ leverage: "19" }));
    expectRel(e.liq.factor, 2.09, 0.01);
    expect(e.liq.status).toBe("gruen");
    expect(e.liq.text).toBeNull();
    expect(e.suggestion).toBeNull();
    expect(e.warnings).toEqual([]);
    expect(e.status).toBe("gruen");
    expect(e.compliant).toBe(true);
  });

  it.each([
    ["10", 73910.5],
    ["5", 67730.7],
  ])("long %sx liquidation matches spec and is gruen", (leverage, expected) => {
    const e = ok(inputs({ leverage }));
    expectRel(e.liq.price, expected, LIQ_TOL);
    expect(e.liq.status).toBe("gruen");
  });

  it("reports liq distance in % of entry", () => {
    const e = ok(inputs({ leverage: "30" }));
    expectRel(e.liq.distancePct!, ((81005.9 - e.liq.price) / 81005.9) * 100, 1e-9);
  });

  it("liq at or before the stop is rot with the 'Stop greift nicht' text", () => {
    // Very tight safety window: 50x with a wide stop -> liq between entry and stop.
    const e = ok(inputs({ leverage: "50", stop: "75000", tp: "" }));
    expect(e.liq.factor).toBeLessThanOrEqual(1);
    expect(e.liq.status).toBe("rot");
    expect(e.liq.text).toBe(TEXT_LIQ_AT_OR_BEFORE_STOP);
  });

  it("suggests 'auch 1x reicht nicht' when no leverage reaches the safety factor", () => {
    // entry 100, stop 70: 1x liq ≈ 50.1 -> factor ≈ 1.66 (gelb); k = 2 needs liq ≤ 40 -> impossible
    const e = ok(inputs({ entry: "100", stop: "70", tp: "", leverage: "1" }));
    expect(e.liq.status).toBe("gelb");
    expect(e.suggestion).toEqual({ maxLeverage: null, text: "Vorschlag: auch 1x reicht nicht" });
  });

  it("respects custom safety and near factors", () => {
    // 20x factor ≈ 1.98: with safety 1.9 it is gruen; with near 1.98+ it would be rot
    expect(ok(inputs({ leverage: "20", safetyFactor: "1.9", nearFactor: "1.5" })).liq.status).toBe("gruen");
    expect(ok(inputs({ leverage: "20", safetyFactor: "3", nearFactor: "2,5" })).liq.status).toBe("rot");
  });

  describe("short", () => {
    it("30x short: liq within 0.5 % of Bitunix panel 83752.5, rot", () => {
      const e = ok(inputs({ direction: "short", stop: SHORT_STOP, tp: SHORT_TP, leverage: "30" }));
      expectRel(e.liq.price, 83752.5, LIQ_TOL);
      expect(e.liq.price).toBeGreaterThan(81005.9);
      expect(e.liq.status).toBe("rot");
      expect(e.suggestion?.maxLeverage).not.toBeNull();
    });

    it("short classification is symmetric: suggested leverage is gruen, one more is not", () => {
      const red = ok(inputs({ direction: "short", stop: SHORT_STOP, tp: SHORT_TP, leverage: "30" }));
      const L = red.suggestion!.maxLeverage!;
      const atL = ok(inputs({ direction: "short", stop: SHORT_STOP, tp: SHORT_TP, leverage: String(L) }));
      const above = ok(
        inputs({ direction: "short", stop: SHORT_STOP, tp: SHORT_TP, leverage: String(L + 1) }),
      );
      expect(atL.liq.status).toBe("gruen");
      expect(above.liq.status).not.toBe("gruen");
      expect(atL.positionUsd).toBeGreaterThan(0);
      expect(atL.gainBtc!).toBeGreaterThan(0);
    });

    it("short without reachable liquidation (denominator <= 0) is Infinity and treated as safe", () => {
      const e = ok(inputs({ direction: "short", stop: SHORT_STOP, tp: SHORT_TP, leverage: "1", mmr: "0" }));
      expect(e.liq.price).toBe(Infinity);
      expect(e.liq.factor).toBe(Infinity);
      expect(e.liq.status).toBe("gruen");
      expect(e.liq.distancePct).toBeNull();
      expect(e.suggestion).toBeNull();
      expect(e.compliant).toBe(true);
      // Journal: no liquidation -> empty cell
      const tsv = buildJournalTsv(toJournalRow(e), new Date(2026, 9, 20, 9, 5));
      expect(tsv.split("\n")[1].split("\t")[12]).toBe("");
    });
  });
});

describe("Bitunix panel liquidation", () => {
  it("is classified with the same thresholds as the computed liq", () => {
    // Computed 19x is gruen; panel near the stop (factor ≈ 1.28) -> rot
    const e = ok(inputs({ leverage: "19", panelLiq: "78697,5" }));
    expect(e.liq.status).toBe("gruen");
    expect(e.panelLiq).not.toBeNull();
    expect(e.panelLiq!.price).toBe(78697.5);
    expect(e.panelLiq!.status).toBe("rot");
    expect(e.panelLiq!.text).toBe(TEXT_LIQ_NEAR_STOP);
    expect(e.warnings).toContainEqual({ source: "panelLiq", status: "rot", text: TEXT_LIQ_NEAR_STOP });
    expect(e.status).toBe("rot");
    expect(e.compliant).toBe(false);
  });

  it("panel liq between entry and stop (before stop) is rot", () => {
    const e = ok(inputs({ leverage: "19", panelLiq: "80000" }));
    expect(e.panelLiq!.status).toBe("rot");
    expect(e.panelLiq!.text).toBe(TEXT_LIQ_AT_OR_BEFORE_STOP);
    expect(e.compliant).toBe(false);
  });

  it("panel liq on the wrong side of entry is rot", () => {
    const e = ok(inputs({ leverage: "19", panelLiq: "82000" }));
    expect(e.panelLiq!.factor).toBeLessThan(0);
    expect(e.panelLiq!.status).toBe("rot");
    expect(e.panelLiq!.text).toBe(TEXT_LIQ_AT_OR_BEFORE_STOP);
  });

  it("panel liq exactly at the stop is rot", () => {
    const e = ok(inputs({ leverage: "19", panelLiq: "79205.2" }));
    expect(e.panelLiq!.status).toBe("rot");
    expect(e.panelLiq!.text).toBe(TEXT_LIQ_AT_OR_BEFORE_STOP);
  });

  it("panel liq at factor ≈ 1.98 is gelb, far away is gruen", () => {
    expect(ok(inputs({ leverage: "19", panelLiq: "77443.5" })).panelLiq!.status).toBe("gelb");
    const far = ok(inputs({ leverage: "19", panelLiq: "70000" }));
    expect(far.panelLiq!.status).toBe("gruen");
    expect(far.warnings).toEqual([]);
  });

  it("short panel 83752.5 at 30x is classified relative to the short stop", () => {
    const e = ok(inputs({ direction: "short", stop: SHORT_STOP, tp: SHORT_TP, leverage: "30", panelLiq: "83752.5" }));
    expectRel(e.panelLiq!.factor, (83752.5 - 81005.9) / (82806.6 - 81005.9), 1e-9);
    expect(e.panelLiq!.status).toBe("gelb");
  });

  it("no panel value -> panelLiq null", () => {
    expect(ok(inputs()).panelLiq).toBeNull();
  });

  it("journal uses the panel liq when entered, else the computed liq", () => {
    const withPanel = ok(inputs({ leverage: "30", panelLiq: "78.697,5" }));
    expect(toJournalRow(withPanel).liqPrice).toBe(78697.5);
    const tsv = buildJournalTsv(toJournalRow(withPanel), new Date(2026, 9, 20, 9, 5));
    expect(tsv.split("\n")[1].split("\t")[12]).toBe("78697,5");

    const computed = ok(inputs({ leverage: "30" }));
    expect(toJournalRow(computed).liqPrice).toBe(computed.liq.price);
  });

  it("invalid panel value is an error", () => {
    expect(errors(inputs({ panelLiq: "abc" }))).toContainEqual(
      expect.objectContaining({ field: "panelLiq", kind: "invalid" }),
    );
    expect(errors(inputs({ panelLiq: "0" }))).toContainEqual(
      expect.objectContaining({ field: "panelLiq", kind: "range" }),
    );
  });
});

describe("errors block results", () => {
  it("long stop at or above entry", () => {
    for (const stop of ["81005.9", "82000"]) {
      expect(errors(inputs({ stop }))).toContainEqual({
        field: "stop",
        kind: "side",
        message: TEXT_STOP_WRONG_SIDE,
      });
    }
  });

  it("short stop at or below entry", () => {
    for (const stop of ["81005.9", "79205.2"]) {
      expect(errors(inputs({ direction: "short", stop, tp: SHORT_TP }))).toContainEqual({
        field: "stop",
        kind: "side",
        message: TEXT_STOP_WRONG_SIDE,
      });
    }
  });

  it("long TP at or below entry", () => {
    for (const tp of ["81005.9", "80000"]) {
      expect(errors(inputs({ tp }))).toContainEqual({ field: "tp", kind: "side", message: TEXT_TP_WRONG_SIDE });
    }
  });

  it("short TP at or above entry", () => {
    for (const tp of ["81005.9", "84707.1"]) {
      expect(errors(inputs({ direction: "short", stop: SHORT_STOP, tp }))).toContainEqual({
        field: "tp",
        kind: "side",
        message: TEXT_TP_WRONG_SIDE,
      });
    }
  });

  it.each(["balance", "riskPct", "riskLimitPct", "entry", "stop", "leverage", "bufferPct", "mmr"] as const)(
    "missing required %s",
    (field) => {
      const errs = errors(inputs({ [field]: "" }));
      expect(errs).toContainEqual(expect.objectContaining({ field, kind: "missing" }));
      expect(errs.find((e) => e.field === field)!.message).toMatch(/fehlt/);
    },
  );

  it("missing riskBtc in amount mode", () => {
    expect(errors(inputs({ riskMode: "amount", riskBtc: "" }))).toContainEqual(
      expect.objectContaining({ field: "riskBtc", kind: "missing" }),
    );
  });

  it.each(["balance", "entry", "stop", "leverage", "mmr"] as const)("invalid number in %s", (field) => {
    expect(errors(inputs({ [field]: "abc" }))).toContainEqual(
      expect.objectContaining({ field, kind: "invalid" }),
    );
  });

  it.each([
    ["balance", "0"],
    ["balance", "-1"],
    ["riskPct", "0"],
    ["entry", "0"],
    ["leverage", "0"],
    ["leverage", "51"],
    ["leverage", "10.5"],
    ["bufferPct", "-1"],
    ["bufferPct", "100"],
    ["mmr", "0.5"],
    ["mmr", "-0.001"],
    ["safetyFactor", "1"],
    ["nearFactor", "0.9"],
  ] as const)("out of range %s = %s", (field, value) => {
    expect(errors(inputs({ [field]: value }))).toContainEqual(
      expect.objectContaining({ field, kind: "range" }),
    );
  });

  it("near factor above safety factor is an error", () => {
    expect(errors(inputs({ safetyFactor: "2", nearFactor: "2.5" }))).toContainEqual(
      expect.objectContaining({ field: "nearFactor", kind: "range" }),
    );
  });

  it("accepts boundary values (leverage 1 and 50, buffer 0, mmr 0)", () => {
    expect(evaluate(inputs({ leverage: "1" })).ok).toBe(true);
    expect(evaluate(inputs({ leverage: "50" })).ok).toBe(true);
    expect(evaluate(inputs({ bufferPct: "0", mmr: "0" })).ok).toBe(true);
  });

  it("empty TP is not an error: no gain/CRV, journal CRV and TP empty", () => {
    const e = ok(inputs({ tp: "", leverage: "19" }));
    expect(e.inputs.tp).toBeNull();
    expect(e.gainBtc).toBeNull();
    expect(e.crv).toBeNull();
    expect(e.positionUsd).toBeGreaterThan(0);
    const cells = buildJournalTsv(toJournalRow(e), new Date(2026, 9, 20, 9, 5)).split("\n")[1].split("\t");
    expect(cells[5]).toBe("");
    expect(cells[13]).toBe("");
  });

  it("whitespace-only TP counts as empty", () => {
    expect(ok(inputs({ tp: "   " })).crv).toBeNull();
  });
});

describe("non-computable sizing blocks results (QA defect 2)", () => {
  const SIZING_ERROR: InputError = { field: "stop", kind: "calc", message: TEXT_SIZING_NOT_COMPUTABLE };

  it("long stop one ULP-scale step below entry (1/stop - 1/entry === 0) is a calc error on stop", () => {
    const raw = inputs({ entry: "13", stop: "12.999999999999998", tp: "14", bufferPct: "0", leverage: "10" });
    expect(12.999999999999998).toBeLessThan(13); // individually valid: stop is on the correct side
    const result = evaluate(raw);
    expect(result).toEqual({ ok: false, errors: [SIZING_ERROR] });
    expect("value" in result).toBe(false);
  });

  it("same tiny stop distance without TP is still blocked", () => {
    expect(errors(inputs({ entry: "13", stop: "12.999999999999998", tp: "", bufferPct: "0" }))).toEqual([
      SIZING_ERROR,
    ]);
  });

  it("arithmetic overflow of the position size (Infinity) is a calc error, never a compliant result", () => {
    const huge = `1${"0".repeat(305)}`; // 1e305 BTC balance, finite and > 0
    const raw = inputs({ balance: huge, entry: "100", stop: "99.9999", tp: "", leverage: "10" });
    expect(errors(raw)).toEqual([SIZING_ERROR]);
  });

  it("field errors take precedence: a wrong-side stop still reports the side error, not the calc error", () => {
    const errs = errors(inputs({ entry: "13", stop: "13.000000000000002", tp: "14" }));
    expect(errs).toContainEqual({ field: "stop", kind: "side", message: TEXT_STOP_WRONG_SIDE });
    expect(errs).not.toContainEqual(SIZING_ERROR);
  });

  it("a small but computable stop distance still evaluates with finite sizing", () => {
    const e = ok(inputs({ entry: "13", stop: "12.99", tp: "14", bufferPct: "0", leverage: "10" }));
    for (const v of [e.positionUsd, e.positionBtc, e.marginBtc, e.approxPositionUsd, e.effectiveLeverage, e.gainBtc!, e.crv!]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(e.positionUsd).toBeGreaterThan(0);
  });

  it("regression guard: intentional short 1x m=0 liquidation Infinity still evaluates ok with finite sizing", () => {
    const e = ok(inputs({ direction: "short", stop: SHORT_STOP, tp: SHORT_TP, leverage: "1", mmr: "0" }));
    expect(e.liq.price).toBe(Infinity);
    expect(e.compliant).toBe(true);
    for (const v of [e.positionUsd, e.positionBtc, e.marginBtc, e.gainBtc!, e.crv!]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    const cells = buildJournalTsv(toJournalRow(e), new Date(2026, 9, 20, 9, 5)).split("\n")[1].split("\t");
    expect(cells[12]).toBe("");
    for (const cell of cells) expect(cell).not.toMatch(/∞|Infinity|NaN/);
  });
});

describe("liquidation near the float limit never fails open (final review)", () => {
  const E308 = `1${"0".repeat(308)}`; // 1e308, finite, typed without exponent notation

  it("long entry 1e308 / stop 5e307 at 2x, m 0: finite liquidation before the stop -> rot, not compliant", () => {
    const e = ok(inputs({ entry: E308, stop: `5${"0".repeat(307)}`, tp: "", leverage: "2", bufferPct: "0", mmr: "0" }));
    expectRel(e.liq.price, (2 / 3) * 1e308, 1e-12);
    expectRel(e.liq.factor, 2 / 3, 1e-12);
    expect(e.status).toBe("rot");
    expect(e.compliant).toBe(false);
  });

  it("short whose liquidation overflows is a calc error, not 'keine Liquidation'", () => {
    const raw = inputs({ direction: "short", entry: E308, stop: `15${"0".repeat(307)}`, tp: "", leverage: "1" });
    expect(errors(raw)).toEqual([{ field: "entry", kind: "calc", message: TEXT_LIQ_NOT_COMPUTABLE }]);
  });
});

describe("copy values end to end: never above the calculated sizing (QA copy rounding)", () => {
  /** Exchange copy values (as the copy buttons produce them) and the journal copy cells for `e`. */
  function copies(e: Evaluation): { copy: [string, string, string]; journal: [string, string, string] } {
    const cells = buildJournalTsv(toJournalRow(e), new Date(2026, 9, 20, 9, 5)).split("\n")[1].split("\t");
    const copy: [string, string, string] = [
      toCopyValue(e.positionUsd, COPY_DECIMALS.positionUsd),
      toCopyValue(e.positionBtc, COPY_DECIMALS.positionBtc),
      toCopyValue(e.marginBtc, COPY_DECIMALS.marginBtc),
    ];
    const journal: [string, string, string] = [cells[8], cells[9], cells[11]];
    const sources = [e.positionUsd, e.positionBtc, e.marginBtc];
    sources.forEach((source, i) => {
      expect(Number(copy[i]), `copy ${copy[i]} exceeds ${source}`).toBeLessThanOrEqual(source);
      expect(Number(journal[i].replace(",", ".")), `journal ${journal[i]} exceeds ${source}`).toBeLessThanOrEqual(
        source,
      );
    });
    return { copy, journal };
  }

  it("QA reproduction A: BTC risk a few ULPs below a step copies down end to end", () => {
    const e = ok(
      inputs({
        balance: "1000",
        riskMode: "amount",
        riskBtc: "12.92999999999999",
        entry: "100",
        stop: "50",
        tp: "150",
        leverage: "10",
        bufferPct: "0",
      }),
    );
    expect(e.positionUsd).toBeLessThan(1293);
    expect(e.positionBtc).toBeLessThan(12.93);
    expect(e.marginBtc).toBeLessThan(1.293);
    expect(copies(e)).toEqual({
      copy: ["1292", "12.9299", "1.29299999"],
      journal: ["1292", "12,9299", "1,29299999"],
    });
  });

  it("QA reproduction B: an exact large position keeps its step (no added increments)", () => {
    const e = ok(
      inputs({
        balance: "10000000000000",
        riskMode: "amount",
        riskBtc: "1000000000000",
        entry: "100",
        stop: "50",
        tp: "150",
        leverage: "10",
        bufferPct: "0",
      }),
    );
    expect(e.positionBtc).toBe(1000000000000);
    expect(copies(e)).toEqual({
      copy: ["100000000000000", "1000000000000.0000", "100000000000.00000000"],
      journal: ["100000000000000", "1000000000000", "100000000000"],
    });
  });

  it("QA reproduction C: tiny but finite stop distance never copies above the calculated position", () => {
    const e = ok(
      inputs({
        balance: DEFAULT_INPUTS.balance,
        riskPct: DEFAULT_INPUTS.riskPct,
        entry: "100",
        stop: "99.99999999999999",
        tp: "101",
        leverage: "30",
        bufferPct: "0",
      }),
    );
    expect(e.positionBtc).toBe(2090667504201.3953);
    const { copy, journal } = copies(e);
    expect(copy[1]).toBe("2090667504201.3953");
    expect(journal[1]).toBe("2090667504201,3953");
  });
});

describe("fees/slippage buffer", () => {
  it("5 % buffer reduces net risk and position by 5 %, gross risk unchanged", () => {
    const none = ok(inputs({ bufferPct: "0" }));
    const five = ok(inputs({ bufferPct: "5" }));
    expect(five.grossRiskBtc).toBe(none.grossRiskBtc);
    expect(five.riskPctEffective).toBe(none.riskPctEffective);
    expectRel(five.riskBtc, none.riskBtc * 0.95, 1e-12);
    expectRel(five.positionUsd, none.positionUsd * 0.95, 1e-12);
    expectRel(five.positionBtc, none.positionBtc * 0.95, 1e-12);
    expectRel(five.marginBtc, none.marginBtc * 0.95, 1e-12);
    expectRel(five.approxPositionUsd, none.approxPositionUsd * 0.95, 1e-12);
    // CRV is a ratio of gain to the sized risk, so it does not change.
    expectRel(five.crv!, none.crv!, 1e-12);
  });

  it("journal Risiko BTC is the gross risk", () => {
    const five = ok(inputs({ bufferPct: "5" }));
    expect(toJournalRow(five).riskBtc).toBe(five.grossRiskBtc);
  });
});

describe("risk limit", () => {
  it("pct mode: riskPct above the limit is gelb and still compliant", () => {
    const e = ok(inputs({ riskPct: "12", riskLimitPct: "10", leverage: "19" }));
    expect(e.riskOverLimit).toBe(true);
    expect(e.warnings).toContainEqual({ source: "risk", status: "gelb", text: TEXT_RISK_OVER_LIMIT });
    expect(e.status).toBe("gelb");
    expect(e.compliant).toBe(true);
  });

  it("pct mode: risk equal to the limit is not over the limit", () => {
    const e = ok(inputs({ riskPct: "10", riskLimitPct: "10", leverage: "19" }));
    expect(e.riskOverLimit).toBe(false);
    expect(e.status).toBe("gruen");
  });

  it("btc mode: risk BTC above balance * limit is gelb", () => {
    // limit = 0.00725346 * 10 % = 0.000725346
    const e = ok(inputs({ riskMode: "amount", riskBtc: "0.001", leverage: "19" }));
    expect(e.riskOverLimit).toBe(true);
    expectRel(e.riskLimit, 0.000725346, 1e-9);
    expect(e.status).toBe("gelb");
    expect(e.compliant).toBe(true);
  });

  it("limit is checked against gross risk (buffer does not hide an over-limit risk)", () => {
    const e = ok(inputs({ riskPct: "10.5", riskLimitPct: "10", bufferPct: "10", leverage: "19" }));
    expect(e.riskBtc).toBeLessThan(e.riskLimit);
    expect(e.riskOverLimit).toBe(true);
  });

  it("over-limit plus rot liquidation: overall rot, not compliant", () => {
    const e = ok(inputs({ riskPct: "12", riskLimitPct: "10", leverage: "30" }));
    expect(e.riskOverLimit).toBe(true);
    expect(e.status).toBe("rot");
    expect(e.compliant).toBe(false);
    expect(toJournalRow(e).compliant).toBe(false);
  });
});

/**
 * Spreadsheet example, USDT account: equity 1000, 1 %, buffer 0, 2x, long 90000 / 80000, TP 110000.
 * The BTC balance is left empty: a USDT account must not need it.
 */
function usdt(overrides: Partial<RawInputs> = {}): RawInputs {
  return inputs({
    account: "usdt",
    balance: "",
    balanceUsdt: "1000",
    riskPct: "1",
    leverage: "2",
    entry: "90000",
    stop: "80000",
    tp: "110000",
    bufferPct: "0",
    ...overrides,
  });
}

function ladderOf(e: Evaluation) {
  if (e.takeProfits.plan !== "ladder") throw new Error(`expected ladder, got ${e.takeProfits.plan}`);
  return e.takeProfits.rows;
}

function partialOf(e: Evaluation) {
  if (e.takeProfits.plan !== "partial") throw new Error(`expected partial, got ${e.takeProfits.plan}`);
  return e.takeProfits;
}

describe("USDT account sizing", () => {
  it("spreadsheet example: 10 USDT risk -> 90 USD, 0.001 BTC, margin 0.0005 BTC (45 USDT), risk 0.000125 BTC", () => {
    const e = ok(usdt());
    expect(e.inputs.account).toBe("usdt");
    expect(e.inputs.balance).toBe(1000);
    expect(e.grossRisk).toBe(10);
    expect(e.riskPctEffective).toBe(1);
    // 10 USDT at the stop price 80000
    expect(e.riskBtc).toBeCloseTo(0.000125, 15);
    expect(e.grossRiskBtc).toBeCloseTo(0.000125, 15);
    // N_usd = 10 · 90000 / 10000
    expect(e.positionUsd).toBeCloseTo(90, 9);
    expect(e.positionBtc).toBeCloseTo(0.001, 15);
    expect(e.marginBtc).toBeCloseTo(0.0005, 15);
    expect(e.marginUsdt).toBeCloseTo(45, 9);
    expect(e.lossAtStopUsdt).toBeCloseTo(10, 9);
    // 90 USD / 1000 USDT
    expect(e.effectiveLeverage).toBeCloseTo(0.09, 12);
    expect(e.stopDistancePct).toBeCloseTo(100 / 9, 9);
    // linear control: 0.000125 · 90000 / (10000 / 90000)
    expect(e.approxPositionUsd).toBeCloseTo(101.25, 9);
    expect(e.riskLimit).toBe(100);
    expect(e.riskOverLimit).toBe(false);
  });

  it("copy values of the example are the sheet's sizes: 90 USD, 0.0010 BTC, 0.00050000 BTC margin", () => {
    const e = ok(usdt());
    expect(toCopyValue(e.positionUsd, COPY_DECIMALS.positionUsd)).toBe("90");
    expect(toCopyValue(e.positionBtc, COPY_DECIMALS.positionBtc)).toBe("0.0010");
    expect(toCopyValue(e.marginBtc, COPY_DECIMALS.marginBtc)).toBe("0.00050000");
  });

  it("gain at TP: 90 · (1/90000 − 1/110000) = 1/5500 BTC, worth 20 USDT at 110000", () => {
    const e = ok(usdt());
    expect(e.gainBtc!).toBeCloseTo(1 / 5500, 15);
    expect(e.gainAtTpUsdt!).toBeCloseTo(20, 9);
    // btc basis (default): (1/5500) / 0.000125 = 16/11; usd basis: 20000 / 10000 = 2
    expect(e.crv!).toBeCloseTo(16 / 11, 12);
    expect(ok(usdt({ crvBasis: "usd" })).crv).toBe(2);
  });

  it("short 90000 / 100000: 10 USDT at the stop -> risk 0.0001 BTC, N_usd 90, 0.001 BTC", () => {
    const e = ok(usdt({ direction: "short", stop: "100000", tp: "70000" }));
    expect(e.riskBtc).toBeCloseTo(0.0001, 15);
    expect(e.positionUsd).toBeCloseTo(90, 9);
    expect(e.positionBtc).toBeCloseTo(0.001, 15);
    expect(e.lossAtStopUsdt).toBeCloseTo(10, 9);
    // 90 · 20000 / 90000
    expect(e.gainAtTpUsdt!).toBeCloseTo(20, 9);
  });

  it("ignores the BTC balance and BTC risk fields", () => {
    const plain = ok(usdt());
    const junk = ok(usdt({ balance: "abc", riskBtc: "abc" }));
    expect(junk.positionUsd).toBe(plain.positionUsd);
  });

  it("a BTC account ignores the USDT equity and USDT risk fields", () => {
    const plain = ok(inputs());
    const junk = ok(inputs({ balanceUsdt: "abc", riskUsdt: "-1" }));
    expect(junk.positionUsd).toBe(plain.positionUsd);
    expect(junk.inputs.balance).toBe(0.00725346);
  });

  it("missing, invalid or non-positive USDT equity is an error on balanceUsdt", () => {
    expect(errors(usdt({ balanceUsdt: "" }))).toContainEqual(
      expect.objectContaining({ field: "balanceUsdt", kind: "missing" }),
    );
    expect(errors(usdt({ balanceUsdt: "abc" }))).toContainEqual(
      expect.objectContaining({ field: "balanceUsdt", kind: "invalid" }),
    );
    expect(errors(usdt({ balanceUsdt: "0" }))).toContainEqual(
      expect.objectContaining({ field: "balanceUsdt", kind: "range" }),
    );
    expect(errors(usdt({ balanceUsdt: "" })).map((err) => err.field)).not.toContain("balance");
  });

  it("accepts German formatted equity", () => {
    expect(ok(usdt({ balanceUsdt: "1.000,0" })).grossRisk).toBe(10);
  });
});

describe("USDT account, risk amount mode", () => {
  it("a fixed 25 USDT risk: 2.5 % of 1000, risk 0.0003125 BTC, N_usd 225, 0.0025 BTC", () => {
    const e = ok(usdt({ riskMode: "amount", riskUsdt: "25", riskPct: "abc", riskBtc: "abc" }));
    expect(e.grossRisk).toBe(25);
    expect(e.riskPctEffective).toBeCloseTo(2.5, 12);
    expect(e.riskBtc).toBeCloseTo(0.0003125, 15);
    expect(e.positionUsd).toBeCloseTo(225, 9);
    expect(e.positionBtc).toBeCloseTo(0.0025, 15);
    expect(e.marginBtc).toBeCloseTo(0.00125, 15);
    expect(e.lossAtStopUsdt).toBeCloseTo(25, 9);
  });

  it("missing, invalid or non-positive USDT risk is an error on riskUsdt (not riskBtc)", () => {
    const missing = errors(usdt({ riskMode: "amount", riskUsdt: "" }));
    expect(missing).toContainEqual(expect.objectContaining({ field: "riskUsdt", kind: "missing" }));
    expect(missing.map((err) => err.field)).not.toContain("riskBtc");
    expect(errors(usdt({ riskMode: "amount", riskUsdt: "abc" }))).toContainEqual(
      expect.objectContaining({ field: "riskUsdt", kind: "invalid" }),
    );
    expect(errors(usdt({ riskMode: "amount", riskUsdt: "0" }))).toContainEqual(
      expect.objectContaining({ field: "riskUsdt", kind: "range" }),
    );
  });
});

describe("USDT account, risk limit and buffer", () => {
  it("pct above the limit: 120 USDT over 100 USDT is gelb and compliant", () => {
    const e = ok(usdt({ riskPct: "12", riskLimitPct: "10" }));
    expect(e.grossRisk).toBe(120);
    expect(e.riskLimit).toBe(100);
    expect(e.riskOverLimit).toBe(true);
    expect(e.warnings).toContainEqual({ source: "risk", status: "gelb", text: TEXT_RISK_OVER_LIMIT });
    expect(e.liq.status).toBe("gruen");
    expect(e.status).toBe("gelb");
    expect(e.compliant).toBe(true);
  });

  it("amount mode compares the USDT amount with the USDT limit (150 over, 100 equal is not)", () => {
    expect(ok(usdt({ riskMode: "amount", riskUsdt: "150" })).riskOverLimit).toBe(true);
    const equal = ok(usdt({ riskMode: "amount", riskUsdt: "100" }));
    expect(equal.riskOverLimit).toBe(false);
    expect(equal.warnings).toEqual([]);
  });

  it("the limit is checked against gross risk: 105 USDT over 100 even though only 94.5 are sized", () => {
    const e = ok(usdt({ riskPct: "10.5", bufferPct: "10" }));
    expect(e.grossRisk).toBeCloseTo(105, 9);
    expect(e.lossAtStopUsdt).toBeCloseTo(94.5, 9);
    expect(e.riskOverLimit).toBe(true);
  });

  it("5 % buffer sizes 9.5 of 10 USDT: risk 0.00011875 BTC, N_usd 85.5; gross figures unchanged", () => {
    const e = ok(usdt({ bufferPct: "5" }));
    expect(e.grossRisk).toBe(10);
    expect(e.riskPctEffective).toBe(1);
    expect(e.grossRiskBtc).toBeCloseTo(0.000125, 15);
    expect(e.riskBtc).toBeCloseTo(0.00011875, 15);
    expect(e.positionUsd).toBeCloseTo(85.5, 9);
    expect(e.positionBtc).toBeCloseTo(0.00095, 15);
    expect(e.lossAtStopUsdt).toBeCloseTo(9.5, 9);
    // Journal columns are unchanged: Risiko BTC is the gross BTC risk.
    expect(toJournalRow(e).riskBtc).toBeCloseTo(0.000125, 15);
    expect(toJournalRow(e).riskPct).toBe(1);
  });
});

describe("BTC account: USDT values at the stop/TP price", () => {
  // 1 BTC, 1 %, buffer 0, long 90000 / 80000, TP 120000: risk 0.01 BTC, N_usd 0.01 · 720000 = 7200.
  const btcTrade = (overrides: Partial<RawInputs> = {}) =>
    inputs({ balance: "1", riskPct: "1", entry: "90000", stop: "80000", tp: "120000", leverage: "10", ...overrides });

  it("loss at stop = riskBtc · stop = N_usd · |entry − stop| / entry = 800 USDT", () => {
    const e = ok(btcTrade());
    expect(e.riskBtc).toBe(0.01);
    expect(e.positionUsd).toBeCloseTo(7200, 9);
    expect(e.lossAtStopUsdt).toBeCloseTo(800, 9);
    expect(e.riskLimit).toBeCloseTo(0.1, 15);
    expect(e.effectiveLeverage).toBeCloseTo(0.08, 12);
    // margin 0.008 BTC at entry
    expect(e.marginUsdt).toBeCloseTo(720, 9);
  });

  it("gain at TP = gainBtc · tp = N_usd · |tp − entry| / entry = 2400 USDT", () => {
    const e = ok(btcTrade());
    // 7200 · (1/90000 − 1/120000) = 0.02
    expect(e.gainBtc!).toBeCloseTo(0.02, 15);
    expect(e.gainAtTpUsdt!).toBeCloseTo(2400, 9);
  });

  it("Fall A: loss at stop is riskBtc valued at 79205.2", () => {
    const e = ok(inputs());
    // 0.000362673 · 79205.2
    expect(e.lossAtStopUsdt).toBeCloseTo(28.7255874996, 6);
  });

  it("no TP: no USDT gain", () => {
    expect(ok(btcTrade({ tp: "" })).gainAtTpUsdt).toBeNull();
  });
});

describe("CRV basis in the evaluation", () => {
  it("long 90000/80000, TP 120000: btc basis 2, usd basis 3; the journal CRV follows the basis", () => {
    const raw = inputs({ balance: "1", riskPct: "1", entry: "90000", stop: "80000", tp: "120000", leverage: "10" });
    const btc = ok(raw);
    const usd = ok({ ...raw, crvBasis: "usd" });
    expect(btc.crv!).toBeCloseTo(2, 12);
    expect(usd.crv).toBe(3);
    expect(usd.inputs.crvBasis).toBe("usd");
    expect(toJournalRow(usd).crv).toBe(3);
    // Sizing does not depend on the basis.
    expect(usd.positionUsd).toBe(btc.positionUsd);
  });

  it("short 108000/110500, TP 103000 is 2 R in the usd basis", () => {
    const e = ok(inputs({ direction: "short", entry: "108000", stop: "110500", tp: "103000", crvBasis: "usd" }));
    expect(e.crv).toBe(2);
  });

  it("Fall A in the usd basis: 3701.2 / 1800.7", () => {
    expect(ok(inputs({ crvBasis: "usd" })).crv!).toBeCloseTo(3701.2 / 1800.7, 12);
  });
});

describe("take-profit ladder in the evaluation", () => {
  it("usd basis USDT example: 12 rows, 2 R at 110000 gains 20 USDT, 10 R at 190000 gains 100 USDT", () => {
    const rows = ladderOf(ok(usdt({ crvBasis: "usd" })));
    expect(rows).toHaveLength(12);
    const two = rows.find((row) => row.crv === 2)!.outcome!;
    expect(two.tp).toBe(110000);
    expect(two.gainUsdt).toBeCloseTo(20, 9);
    expect(two.gainBtc).toBeCloseTo(1 / 5500, 15);
    const ten = rows.find((row) => row.crv === 10)!.outcome!;
    expect(ten.tp).toBe(190000);
    expect(ten.gainUsdt).toBeCloseTo(100, 9);
  });

  it("btc basis USDT example: bound 8, so 8, 9 and 10 R are unreachable", () => {
    const rows = ladderOf(ok(usdt()));
    expect(rows.filter((row) => row.outcome === null).map((row) => row.crv)).toEqual([8, 9, 10]);
    expect(rows.find((row) => row.crv === 2)!.outcome!.tp).toBe(120000);
  });

  it("does not need the main TP", () => {
    const rows = ladderOf(ok(usdt({ tp: "", crvBasis: "usd" })));
    expect(rows[0].outcome!.tp).toBe(100000);
  });

  it("partial-TP fields are ignored in ladder mode, even when invalid", () => {
    const e = ok(usdt({ tpPlan: "ladder", tp1Crv: "abc", tp2Share: "", tp3Crv: "0", tp3Share: "-5" }));
    expect(e.takeProfits.plan).toBe("ladder");
  });
});

describe("partial take-profits in the evaluation", () => {
  it("defaults 1/2/3 R at 50/30/20 % in the usd basis: TPs 100000/110000/120000, weighted 1.7 R", () => {
    const e = ok(usdt({ tpPlan: "partial", crvBasis: "usd" }));
    const plan = partialOf(e);
    expect(plan.parts.map((p) => [p.crv, p.sharePct, p.tp])).toEqual([
      [1, 50, 100000],
      [2, 30, 110000],
      [3, 20, 120000],
    ]);
    expect(plan.weightedCrv).toBe(1.7);
    expect(plan.totalGainUsdt).toBeCloseTo(17, 9);
    expect(plan.totalGainBtc).toBeCloseTo(17 / 110000, 15);
  });

  it("copy quantities 0.0005 + 0.0003 + 0.0002 add up to the position copy 0.0010", () => {
    const e = ok(usdt({ tpPlan: "partial", crvBasis: "usd" }));
    expect(toCopyValue(e.positionBtc, COPY_DECIMALS.positionBtc)).toBe("0.0010");
    expect(partialOf(e).parts.map((p) => p.copyQtyBtc)).toEqual(["0.0005", "0.0003", "0.0002"]);
  });

  it("btc basis: TPs 102857.1/120000/144000, weighted = total gain BTC / risk BTC ≈ 1.6999985", () => {
    const e = ok(usdt({ tpPlan: "partial" }));
    const plan = partialOf(e);
    expect(plan.parts.map((p) => p.tp)).toEqual([102857.1, 120000, 144000]);
    // 45 · (1/90000 − 1/102857.1) + 27 · (1/90000 − 1/120000) + 18 · (1/90000 − 1/144000)
    // = 6.24998e-5 + 7.5e-5 + 7.5e-5; the 0.1 tick of TP1 lies just below 1 R.
    expect(plan.totalGainBtc).toBeCloseTo(2.124998e-4, 9);
    expect(plan.weightedCrv).toBeCloseTo(1.7, 5);
    expect(plan.weightedCrv).toBeLessThan(1.7);
    expect(plan.weightedCrv).toBeCloseTo(plan.totalGainBtc / e.riskBtc, 12);
  });

  it("a 0 % part has no copy value and the previous part takes the rest", () => {
    const plan = partialOf(ok(usdt({ tpPlan: "partial", crvBasis: "usd", tp1Share: "50", tp2Share: "50", tp3Share: "0" })));
    expect(plan.parts.map((p) => p.copyQtyBtc)).toEqual(["0.0005", "0.0005", null]);
    expect(plan.parts[2].gainUsdt).toBe(0);
    // (50 · 1 + 50 · 2) / 100
    expect(plan.weightedCrv).toBe(1.5);
  });

  it("decimal shares 33,3 + 33,3 + 33,4 are 100 %", () => {
    const e = evaluate(usdt({ tpPlan: "partial", tp1Share: "33,3", tp2Share: "33,3", tp3Share: "33,4" }));
    expect(e.ok).toBe(true);
  });

  it.each([
    ["50", "30", "10", "Anteile der Teil-TPs ergeben 90 % – zusammen müssen es 100 % sein."],
    ["50", "30", "30", "Anteile der Teil-TPs ergeben 110 % – zusammen müssen es 100 % sein."],
    ["0", "0", "0", "Anteile der Teil-TPs ergeben 0 % – zusammen müssen es 100 % sein."],
    ["33,3", "33,3", "33,3", "Anteile der Teil-TPs ergeben 99,9 % – zusammen müssen es 100 % sein."],
  ])("shares %s/%s/%s are a field error on tp3Share: %s", (s1, s2, s3, message) => {
    expect(errors(usdt({ tpPlan: "partial", tp1Share: s1, tp2Share: s2, tp3Share: s3 }))).toContainEqual({
      field: "tp3Share",
      kind: "range",
      message,
    });
  });

  it("missing or invalid part fields are field errors; no sum error while a share is unreadable", () => {
    const missing = errors(usdt({ tpPlan: "partial", tp2Share: "" }));
    expect(missing).toContainEqual(expect.objectContaining({ field: "tp2Share", kind: "missing" }));
    expect(missing.map((err) => err.field)).not.toContain("tp3Share");
    expect(errors(usdt({ tpPlan: "partial", tp1Crv: "abc" }))).toContainEqual(
      expect.objectContaining({ field: "tp1Crv", kind: "invalid" }),
    );
    expect(errors(usdt({ tpPlan: "partial", tp1Crv: "0" }))).toContainEqual(
      expect.objectContaining({ field: "tp1Crv", kind: "range" }),
    );
    expect(errors(usdt({ tpPlan: "partial", tp1Share: "-1", tp2Share: "81" }))).toContainEqual(
      expect.objectContaining({ field: "tp1Share", kind: "range" }),
    );
  });

  it("btc basis long 90000/80000: TP3 at 9 R (bound 8) is unreachable; 9 R in the usd basis is fine", () => {
    expect(errors(usdt({ tpPlan: "partial", tp3Crv: "9" }))).toContainEqual({
      field: "tp3Crv",
      kind: "range",
      message: "TP3 CRV nicht erreichbar – max. 8,00 R bei diesem Stop.",
    });
    expect(errors(usdt({ tpPlan: "partial", tp2Crv: "8" }))).toContainEqual({
      field: "tp2Crv",
      kind: "range",
      message: "TP2 CRV nicht erreichbar – max. 8,00 R bei diesem Stop.",
    });
    const usd = partialOf(ok(usdt({ tpPlan: "partial", crvBasis: "usd", tp3Crv: "9" })));
    expect(usd.parts[2].tp).toBe(180000);
  });

  it("usd basis short 100/150: TP1 at the bound 2 is unreachable", () => {
    const raw = usdt({ tpPlan: "partial", crvBasis: "usd", direction: "short", entry: "100", stop: "150", tp: "", tp1Crv: "2", tp2Crv: "1", tp3Crv: "1,5" });
    expect(errors(raw)).toEqual([
      { field: "tp1Crv", kind: "range", message: "TP1 CRV nicht erreichbar – max. 2,00 R bei diesem Stop." },
    ]);
  });

  it("a part whose TP rounds onto entry is unreachable by the tick (usd short 0.3/0.31, 1 R)", () => {
    const raw = usdt({ tpPlan: "partial", crvBasis: "usd", direction: "short", entry: "0.3", stop: "0.31", tp: "", tp1Crv: "1", tp2Crv: "6", tp3Crv: "10" });
    expect(errors(raw)).toEqual([
      { field: "tp1Crv", kind: "range", message: "TP1 CRV nicht erreichbar – kein TP-Preis auf dem 0,1-USD-Tick." },
    ]);
  });

  it("an unusable stop reports only the stop error, no part errors", () => {
    const errs = errors(usdt({ tpPlan: "partial", stop: "95000", tp: "" }));
    expect(errs).toEqual([{ field: "stop", kind: "side", message: TEXT_STOP_WRONG_SIDE }]);
  });

  it("BTC account with a 1e307 BTC risk (plain digits) evaluates the partial plan without throwing", () => {
    const E307 = `1${"0".repeat(307)}`;
    // usd basis long 1 / 0.5: TPs 1.5 / 2 / 2.5 (the btc basis bound 0.5 / 0.5 = 1 would reject them).
    // lossPerUsd = 1/0.5 − 1/1 = 1, so N_usd = N_btc = 1e307.
    const raw = inputs({
      balance: E307,
      riskMode: "amount",
      riskBtc: E307,
      riskPct: "",
      bufferPct: "0",
      entry: "1",
      stop: "0.5",
      tp: "",
      crvBasis: "usd",
      tpPlan: "partial",
    });
    const result = evaluate(raw);
    expect(result.ok).toBe(true);
    const e = ok(raw);
    expect(e.positionBtc).toBe(1e307);
    expect(e.positionUsd).toBe(1e307);
    const plan = partialOf(e);
    expect(plan.parts.map((p) => p.tp)).toEqual([1.5, 2, 2.5]);
    expect(plan.parts.map((p) => p.qtyBtc)).toEqual([5e306, 2.9999999999999996e306, 2e306]);
    // 5·10^306 + 29999999999999996·10^290 + 20000000000000004·10^290 = 10^307 (the position copy).
    expect(toCopyValue(e.positionBtc, COPY_DECIMALS.positionBtc)).toBe(`${E307}.0000`);
    expect(plan.parts.map((p) => p.copyQtyBtc)).toEqual([
      `5${"0".repeat(306)}.0000`,
      `29999999999999996${"0".repeat(290)}.0000`,
      `20000000000000004${"0".repeat(290)}.0000`,
    ]);
  });
});
