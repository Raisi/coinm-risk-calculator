import { describe, expect, it } from "vitest";
import { COPY_DECIMALS, toCopyValue } from "./format";
import { LADDER_CRVS, ladderRows, partialPlan, type PlanTrade, type TpPart } from "./tpPlan";

// Hand-derived expectations below use the linear identity gain USDT = N_usd · |tp − entry| / entry and
// the inverse gain BTC = N_usd · |1/entry − 1/tp|.

/** Spreadsheet example: long 90000 / 80000; a 10 USDT risk gives N_usd 90, 0.001 BTC, risk 0.000125 BTC. */
const LONG_USD: PlanTrade = { basis: "usd", direction: "long", entry: 90000, stop: 80000 };
const LONG_BTC: PlanTrade = { ...LONG_USD, basis: "btc" };
const POSITION = { usd: 90, btc: 0.001 };
const RISK_BTC = 0.000125;

describe("ladderRows", () => {
  it("covers the R levels 1, 1.5, 2, 2.5, 3, 4 … 10 in order", () => {
    expect(ladderRows(LONG_USD, 90).map((row) => row.crv)).toEqual([1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect([...LADDER_CRVS]).toEqual([1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("usd basis long 90000/80000: tp = 90000 + R · 10000, gain 10 USDT per R for N_usd 90", () => {
    const rows = ladderRows(LONG_USD, 90);
    expect(rows.map((row) => row.outcome?.tp)).toEqual([
      100000, 105000, 110000, 115000, 120000, 130000, 140000, 150000, 160000, 170000, 180000, 190000,
    ]);
    for (const row of rows) {
      expect(row.outcome!.gainUsdt).toBeCloseTo(10 * row.crv, 9);
      // |tp − entry| / entry = R · 10000 / 90000
      expect(row.outcome!.distancePct).toBeCloseTo((row.crv * 100) / 9, 9);
    }
    // 2 R: 90 · (1/90000 − 1/110000) = 1/5500 BTC, worth 20 USDT at 110000.
    const twoR = rows[2].outcome!;
    expect(twoR.gainBtc).toBeCloseTo(1 / 5500, 15);
    expect(twoR.gainUsdt).toBeCloseTo(20, 9);
    expect(twoR.gainUsdt).toBeCloseTo(twoR.gainBtc * twoR.tp, 9);
  });

  it("btc basis long 90000/80000: tp = 720000 / (8 − R), levels at/above the bound 8 are unreachable", () => {
    const rows = ladderRows(LONG_BTC, 90);
    expect(rows.map((row) => row.outcome?.tp ?? null)).toEqual([
      102857.1, 110769.2, 120000, 130909.1, 144000, 180000, 240000, 360000, 720000, null, null, null,
    ]);
    // 2 R: 90 · (1/90000 − 1/120000) = 0.00025 BTC (= 2 · risk 0.000125), 30 USDT at 120000.
    expect(rows[2].outcome!.gainBtc).toBeCloseTo(0.00025, 15);
    expect(rows[2].outcome!.gainUsdt).toBeCloseTo(30, 9);
    // 4 R: 0.0005 BTC, 90 USDT at 180000; 100 % from entry.
    expect(rows[5].outcome!.gainBtc).toBeCloseTo(0.0005, 15);
    expect(rows[5].outcome!.gainUsdt).toBeCloseTo(90, 9);
    expect(rows[5].outcome!.distancePct).toBeCloseTo(100, 9);
  });

  it("usd basis short 100/150: bound 2, so only 1 R (50) and 1.5 R (25) are reachable", () => {
    const rows = ladderRows({ basis: "usd", direction: "short", entry: 100, stop: 150 }, 300);
    expect(rows.map((row) => row.outcome?.tp ?? null)).toEqual([50, 25, null, null, null, null, null, null, null, null, null, null]);
    // 1 R: 300 · (1/50 − 1/100) = 3 BTC, worth 150 USDT at 50 (= 300 · 50 / 100).
    const oneR = rows[0].outcome!;
    expect(oneR.gainBtc).toBeCloseTo(3, 12);
    expect(oneR.gainUsdt).toBeCloseTo(150, 9);
    expect(oneR.distancePct).toBeCloseTo(50, 9);
  });

  it("usd basis short 108000/110500 (bound 43.2): every level reachable, tp = 108000 − R · 2500", () => {
    const rows = ladderRows({ basis: "usd", direction: "short", entry: 108000, stop: 110500 }, 1080);
    expect(rows.map((row) => row.outcome?.tp)).toEqual([
      105500, 104250, 103000, 101750, 100500, 98000, 95500, 93000, 90500, 88000, 85500, 83000,
    ]);
    // gain USDT = 1080 · R · 2500 / 108000 = 25 · R
    for (const row of rows) expect(row.outcome!.gainUsdt).toBeCloseTo(25 * row.crv, 9);
  });

  it("levels whose TP rounds onto entry on the 0.1 tick are unreachable (usd short 0.3/0.31)", () => {
    // R 1 … 4 give 0.29 … 0.26, which round to entry 0.3; R 6 … 10 give 0.24 … 0.2, which round to 0.2.
    const rows = ladderRows({ basis: "usd", direction: "short", entry: 0.3, stop: 0.31 }, 10);
    for (const row of rows.filter((r) => r.crv <= 4)) expect(row.outcome, `R ${row.crv}`).toBeNull();
    for (const row of rows.filter((r) => r.crv >= 6)) expect(row.outcome?.tp, `R ${row.crv}`).toBe(0.2);
  });
});

describe("partialPlan", () => {
  const SPEC_PARTS: TpPart[] = [
    { crv: 1, sharePct: 50, tp: 100000 },
    { crv: 2, sharePct: 30, tp: 110000 },
    { crv: 3, sharePct: 20, tp: 120000 },
  ];

  it("spec example, usd basis long 90000/80000, 1/2/3 R at 50/30/20 %: weighted 1.7 R", () => {
    const plan = partialPlan(LONG_USD, POSITION, RISK_BTC, SPEC_PARTS);
    expect(plan.parts.map((p) => [p.crv, p.sharePct, p.tp])).toEqual([
      [1, 50, 100000],
      [2, 30, 110000],
      [3, 20, 120000],
    ]);
    expect(plan.weightedCrv).toBe(1.7);

    const [p1, p2, p3] = plan.parts;
    expect(p1.qtyUsd).toBeCloseTo(45, 12);
    expect(p2.qtyUsd).toBeCloseTo(27, 12);
    expect(p3.qtyUsd).toBeCloseTo(18, 12);
    expect(p1.qtyBtc).toBeCloseTo(0.0005, 15);
    expect(p2.qtyBtc).toBeCloseTo(0.0003, 15);
    expect(p3.qtyBtc).toBeCloseTo(0.0002, 15);
    expect(plan.parts.map((p) => p.copyQtyBtc)).toEqual(["0.0005", "0.0003", "0.0002"]);

    // gain USDT = qtyUsd · |tp − entry| / entry: 45 · 1/9 = 5, 27 · 2/9 = 6, 18 · 3/9 = 6.
    expect(p1.gainUsdt).toBeCloseTo(5, 9);
    expect(p2.gainUsdt).toBeCloseTo(6, 9);
    expect(p3.gainUsdt).toBeCloseTo(6, 9);
    expect(plan.totalGainUsdt).toBeCloseTo(17, 9);
    // gain BTC: 45 · (1/90000 − 1/100000) = 0.00005, 27 · (1/90000 − 1/110000) = 6/110000, 18 · (1/90000 − 1/120000) = 0.00005.
    expect(p1.gainBtc).toBeCloseTo(0.00005, 15);
    expect(p2.gainBtc).toBeCloseTo(6 / 110000, 15);
    expect(p3.gainBtc).toBeCloseTo(0.00005, 15);
    expect(plan.totalGainBtc).toBeCloseTo(17 / 110000, 15);
    for (const p of plan.parts) expect(p.gainUsdt).toBeCloseTo(p.gainBtc * p.tp, 9);
    expect(p2.distancePct).toBeCloseTo(200 / 9, 9);
  });

  it("btc basis: weighted CRV = total gain BTC / risk BTC (120000 is 2 R, 180000 is 4 R → 3 R)", () => {
    const parts: TpPart[] = [
      { crv: 2, sharePct: 50, tp: 120000 },
      { crv: 4, sharePct: 50, tp: 180000 },
      { crv: 3, sharePct: 0, tp: 144000 },
    ];
    const plan = partialPlan(LONG_BTC, POSITION, RISK_BTC, parts);
    // 45 · (1/90000 − 1/120000) = 0.000125; 45 · (1/90000 − 1/180000) = 0.00025.
    expect(plan.totalGainBtc).toBeCloseTo(0.000375, 15);
    expect(plan.totalGainUsdt).toBeCloseTo(0.000125 * 120000 + 0.00025 * 180000, 9);
    expect(plan.totalGainUsdt).toBeCloseTo(60, 9);
    expect(plan.weightedCrv).toBeCloseTo(3, 12);
  });

  it("the same prices weigh differently in the usd basis (120000 is 3 R, 180000 is 9 R → 6 R)", () => {
    const parts: TpPart[] = [
      { crv: 3, sharePct: 50, tp: 120000 },
      { crv: 9, sharePct: 50, tp: 180000 },
      { crv: 1, sharePct: 0, tp: 100000 },
    ];
    expect(partialPlan(LONG_USD, POSITION, RISK_BTC, parts).weightedCrv).toBe(6);
  });

  it("usd weighted CRV uses the R of the tick-rounded TP, not the requested level", () => {
    const parts: TpPart[] = [
      { crv: 1, sharePct: 100, tp: 100000.1 },
      { crv: 2, sharePct: 0, tp: 110000 },
      { crv: 3, sharePct: 0, tp: 120000 },
    ];
    // 10000.1 / 10000
    expect(partialPlan(LONG_USD, POSITION, RISK_BTC, parts).weightedCrv).toBeCloseTo(1.00001, 12);
  });

  it("usd basis short 108000/110500, 1/2/3 R at 50/30/20 %: weighted 1.7 R, gains 12.5/15/15 USDT", () => {
    const trade: PlanTrade = { basis: "usd", direction: "short", entry: 108000, stop: 110500 };
    const plan = partialPlan(trade, { usd: 1080, btc: 0.01 }, 1080 * (1 / 108000 - 1 / 110500), [
      { crv: 1, sharePct: 50, tp: 105500 },
      { crv: 2, sharePct: 30, tp: 103000 },
      { crv: 3, sharePct: 20, tp: 100500 },
    ]);
    expect(plan.weightedCrv).toBe(1.7);
    expect(plan.parts.map((p) => p.gainUsdt)).toEqual([
      expect.closeTo(12.5, 9),
      expect.closeTo(15, 9),
      expect.closeTo(15, 9),
    ]);
    expect(plan.totalGainUsdt).toBeCloseTo(42.5, 9);
    expect(plan.parts.map((p) => p.copyQtyBtc)).toEqual(["0.0050", "0.0030", "0.0020"]);
  });

  describe("copy quantities", () => {
    function copiesFor(btc: number, shares: [number, number, number]): (string | null)[] {
      const parts = SPEC_PARTS.map((part, i) => ({ ...part, sharePct: shares[i] }));
      return partialPlan(LONG_USD, { usd: btc * 90000, btc }, RISK_BTC, parts).parts.map((p) => p.copyQtyBtc);
    }

    it("the last part gets the remainder so the copies add up to the copyable position (0.0157, 33/33/34)", () => {
      // 0.0157 · 0.33 = 0.005181 -> 0.0051 twice; the rest 0.0157 − 0.0102 = 0.0055 (not 0.0157 · 0.34 -> 0.0053).
      expect(copiesFor(0.0157, [33, 33, 34])).toEqual(["0.0051", "0.0051", "0.0055"]);
    });

    it("a 0 % part has no copy value; the remainder goes to the last part with a share", () => {
      // 50/50/0: 0.007850 -> 0.0078, the second part takes 0.0157 − 0.0078 = 0.0079.
      expect(copiesFor(0.0157, [50, 50, 0])).toEqual(["0.0078", "0.0079", null]);
      expect(copiesFor(0.0157, [50, 0, 50])).toEqual(["0.0078", null, "0.0079"]);
      expect(copiesFor(0.0157, [100, 0, 0])).toEqual(["0.0157", null, null]);
      expect(copiesFor(0.0157, [0, 0, 100])).toEqual([null, null, "0.0157"]);
      expect(copiesFor(0.0157, [0, 100, 0])).toEqual([null, "0.0157", null]);
    });

    it("a 0 % part closes nothing and gains nothing", () => {
      const parts = SPEC_PARTS.map((part, i) => ({ ...part, sharePct: [50, 0, 50][i] }));
      const zero = partialPlan(LONG_USD, POSITION, RISK_BTC, parts).parts[1];
      expect(zero.copyQtyBtc).toBeNull();
      expect(zero.qtyBtc).toBe(0);
      expect(zero.qtyUsd).toBe(0);
      expect(zero.gainBtc).toBe(0);
      expect(zero.gainUsdt).toBe(0);
    });

    it("copies never exceed the copyable position when the position itself rounds down (0.00999999)", () => {
      // Copyable position 0.0099; 0.004999995 -> 0.0049, rest 0.0099 − 0.0049 = 0.0050.
      expect(copiesFor(0.00999999, [50, 50, 0])).toEqual(["0.0049", "0.0050", null]);
    });

    it("a position below one copy step gives 0.0000 everywhere, never a negative remainder", () => {
      expect(copiesFor(0.00005, [50, 30, 20])).toEqual(["0.0000", "0.0000", "0.0000"]);
    });

    // Expected copies: earlier parts floor(position · share) to 0.0001, the last part the rest of the
    // position copy; the literals of each row add up to the position copy given in the name.
    it.each<[number, [number, number, number], (string | null)[]]>([
      // position 0.0157: 0.0052281 -> 0.0052 twice, rest 0.0053
      [0.0157, [33.3, 33.3, 33.4], ["0.0052", "0.0052", "0.0053"]],
      // 0.00157 -> 0.0015 twice, rest 0.0127
      [0.0157, [10, 10, 80], ["0.0015", "0.0015", "0.0127"]],
      // position 1.2345: 0.617283945 -> 0.6172, 0.370370367 -> 0.3703, rest 0.2470
      [1.23456789, [50, 30, 20], ["0.6172", "0.3703", "0.2470"]],
      // position 0.0009: 0.00036 -> 0.0003 twice, rest 0.0003
      [0.0009, [40, 40, 20], ["0.0003", "0.0003", "0.0003"]],
      // position 0.0003: 0.000102 -> 0.0001, 0.000099 -> 0.0000, rest 0.0002
      [0.0003, [34, 33, 33], ["0.0001", "0.0000", "0.0002"]],
    ])("position %s with shares %j copies %j", (btc, shares, expected) => {
      expect(copiesFor(btc, shares)).toEqual(expected);
    });

    it("a position above 2^53 copy steps keeps its last step (1000000000000.0001 BTC at 0/0/100)", () => {
      expect(copiesFor(1000000000000.0001, [0, 0, 100])).toEqual([null, null, "1000000000000.0001"]);
    });

    it("large position 2090667504201.3953 at 50/50/0: 1045333752100.6976 + 1045333752100.6977", () => {
      // Half is 1045333752100.69765 -> floor 1045333752100.6976; the rest of 2090667504201.3953 is …6977.
      expect(toCopyValue(2090667504201.3953, COPY_DECIMALS.positionBtc)).toBe("2090667504201.3953");
      expect(copiesFor(2090667504201.3953, [50, 50, 0])).toEqual([
        "1045333752100.6976",
        "1045333752100.6977",
        null,
      ]);
    });

    it("a 1e307 BTC position does not overflow: finite quantities and exact copies (usd long 1 / 0.5)", () => {
      const plan = partialPlan({ basis: "usd", direction: "long", entry: 1, stop: 0.5 }, { usd: 1e307, btc: 1e307 }, 1e307, [
        { crv: 1, sharePct: 50, tp: 1.5 },
        { crv: 2, sharePct: 30, tp: 2 },
        { crv: 3, sharePct: 20, tp: 2.5 },
      ]);
      // 0.3 is not exact in binary: 1e307 · 0.3 is the double 2.9999999999999996e306.
      expect(plan.parts.map((p) => p.qtyBtc)).toEqual([5e306, 2.9999999999999996e306, 2e306]);
      expect(plan.parts.map((p) => p.qtyUsd)).toEqual([5e306, 2.9999999999999996e306, 2e306]);
      // Position copy 1 followed by 307 zeros; the rest is 10^290 · (10^17 − 5·10^16 − 29999999999999996)
      // = 20000000000000004 · 10^290, so 5·10^306 + 29999999999999996·10^290 + 20000000000000004·10^290 = 10^307.
      expect(plan.parts.map((p) => p.copyQtyBtc)).toEqual([
        `5${"0".repeat(306)}.0000`,
        `29999999999999996${"0".repeat(290)}.0000`,
        `20000000000000004${"0".repeat(290)}.0000`,
      ]);
      // Gains USDT 5e306 · 0.5 + 3e306 · 1 + 2e306 · 1.5 = 8.5e306; weighted (50 · 0.5 + 30 · 1 + 20 · 1.5) / 50.
      expect(plan.totalGainUsdt / 8.5e306).toBeCloseTo(1, 12);
      expect(Number.isFinite(plan.totalGainBtc)).toBe(true);
      expect(plan.weightedCrv).toBeCloseTo(1.7, 12);
    });
  });
});
