import { describe, expect, it } from "vitest";
import {
  approxPositionUsd,
  crvFromPrices,
  gainPerUsd,
  grossRiskBtc,
  liquidationFactor,
  liquidationPrice,
  liquidationPriceLong,
  liquidationPriceShort,
  lossPerUsd,
  MAX_LEVERAGE,
  maxLeverageForFactor,
  maxReachableCrv,
  netRiskBtc,
  positionSize,
  tpForCrv,
  tpOnTickForCrv,
  validLossPerUsd,
} from "./calc";

/** Asserts |actual - expected| <= tol * |expected| (relative tolerance). */
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

// Spec base case.
const BALANCE = 0.00725346;
const ENTRY = 81005.9;
const STOP = 79205.2;
const TP = 84707.1;
const MMR = 0.004;

describe("risk budget", () => {
  it("pct mode takes riskPct % of the balance (Fall A: 5 %)", () => {
    expectRel(grossRiskBtc("pct", BALANCE, 5, 0), 0.000362673, 1e-9);
  });

  it("btc mode uses the BTC input and ignores balance and pct", () => {
    expect(grossRiskBtc("btc", BALANCE, 5, 0.00035)).toBe(0.00035);
  });

  it("buffer reserves bufferPct % for fees/slippage", () => {
    expectRel(netRiskBtc(0.001, 5), 0.00095, 1e-12);
    expect(netRiskBtc(0.001, 0)).toBe(0.001);
  });
});

describe("position sizing (inverse contracts)", () => {
  it("Fall A: 5 % risk -> N_usd, N_btc, margin at 30x and 10x, gain, CRV, eff. leverage", () => {
    const risk = grossRiskBtc("pct", BALANCE, 5, 0);
    const at30 = positionSize("long", risk, ENTRY, STOP, 30);
    const at10 = positionSize("long", risk, ENTRY, STOP, 10);

    expectRel(at30.usd, 1292.2, POS_TOL);
    expectRel(at30.btc, 0.01595, POS_TOL);
    expectRel(at30.marginBtc, 0.000532, POS_TOL);
    expectRel(at10.marginBtc, 0.001595, POS_TOL);
    // Notional does not depend on leverage.
    expect(at10.usd).toBe(at30.usd);
    expect(at10.btc).toBe(at30.btc);

    const gain = at30.usd * gainPerUsd("long", ENTRY, TP);
    expectRel(gain, 0.000697, POS_TOL);
    expectRel(gain / risk, 1.92, POS_TOL);
    expectRel(at30.btc / BALANCE, 2.2, POS_TOL);
  });

  it("Fall B: 0.00035 BTC risk -> N_usd, N_btc, margin at 30x and 10x, gain, CRV, eff. leverage", () => {
    const risk = grossRiskBtc("btc", BALANCE, 0, 0.00035);
    const at30 = positionSize("long", risk, ENTRY, STOP, 30);
    const at10 = positionSize("long", risk, ENTRY, STOP, 10);

    expectRel(at30.usd, 1247.1, POS_TOL);
    expectRel(at30.btc, 0.0154, POS_TOL);
    expectRel(at30.marginBtc, 0.000513, POS_TOL);
    expectRel(at10.marginBtc, 0.00154, POS_TOL);

    const gain = at30.usd * gainPerUsd("long", ENTRY, TP);
    expectRel(gain, 0.000673, POS_TOL);
    expectRel(gain / risk, 1.92, POS_TOL);
    expectRel(at30.btc / BALANCE, 2.12, POS_TOL);
  });

  it("losing exactly the risk budget at the stop (inverse PnL)", () => {
    const risk = 0.000362673;
    const { usd } = positionSize("long", risk, ENTRY, STOP, 10);
    // Inverse long PnL in BTC: N_usd * (1/stop - 1/entry)
    expectRel(usd * (1 / STOP - 1 / ENTRY), risk, 1e-9);

    const shortStop = 82806.6;
    const short = positionSize("short", risk, ENTRY, shortStop, 10);
    expectRel(short.usd * (1 / ENTRY - 1 / shortStop), risk, 1e-9);
  });

  it("loss/gain per USD are positive on the correct sides for both directions", () => {
    expect(lossPerUsd("long", ENTRY, STOP)).toBeGreaterThan(0);
    expect(gainPerUsd("long", ENTRY, TP)).toBeGreaterThan(0);
    expect(lossPerUsd("short", ENTRY, 82806.6)).toBeGreaterThan(0);
    expect(gainPerUsd("short", ENTRY, 77000)).toBeGreaterThan(0);
  });

  it("linear control approximation is close to (and below) the inverse notional for a long", () => {
    const risk = 0.000362673;
    const approx = approxPositionUsd(risk, ENTRY, STOP);
    const exact = positionSize("long", risk, ENTRY, STOP, 10).usd;
    // riskUsd = 29.379...; stop distance 2.2229 % -> ~1321.7 USD
    expectRel(approx, (risk * ENTRY) / ((ENTRY - STOP) / ENTRY), 1e-12);
    expectRel(approx, exact, 0.03);
  });
});

describe("liquidation price", () => {
  it.each([
    [30, 78697.5],
    [20, 77443.5],
    [10, 73910.5],
    [5, 67730.7],
  ])("long %ix matches spec %f within 0.5 %%", (leverage, expected) => {
    expectRel(liquidationPriceLong(ENTRY, leverage, MMR), expected, LIQ_TOL);
    expectRel(liquidationPrice("long", ENTRY, leverage, MMR), expected, LIQ_TOL);
  });

  it("long liquidation lies below entry and moves away from entry as leverage drops", () => {
    const liq30 = liquidationPriceLong(ENTRY, 30, MMR);
    const liq10 = liquidationPriceLong(ENTRY, 10, MMR);
    expect(liq30).toBeLessThan(ENTRY);
    expect(liq10).toBeLessThan(liq30);
  });

  it("short 30x is within 0.5 % of the Bitunix panel value 83752.5 (formula 83453.9)", () => {
    const liq = liquidationPriceShort(ENTRY, 30, MMR);
    expectRel(liq, 83453.9, 1e-5);
    expectRel(liq, 83752.5, LIQ_TOL);
    expect(liquidationPrice("short", ENTRY, 30, MMR)).toBe(liq);
  });

  it("short with denominator <= 0 has no liquidation (Infinity)", () => {
    // L - 1 + L*m = 0 for L = 1, m = 0
    expect(liquidationPriceShort(ENTRY, 1, 0)).toBe(Infinity);
    expect(liquidationPrice("short", ENTRY, 1, 0)).toBe(Infinity);
  });

  it("short 1x with positive m still liquidates far above entry", () => {
    const liq = liquidationPriceShort(ENTRY, 1, MMR);
    expect(Number.isFinite(liq)).toBe(true);
    expectRel(liq, ENTRY / MMR, 1e-12);
  });
});

describe("overflow safety for huge finite prices", () => {
  it("long liquidation stays finite where entry * leverage would overflow", () => {
    expectRel(liquidationPriceLong(1e308, 2, 0), (2 / 3) * 1e308, 1e-12);
  });

  it("maxLeverageForFactor keeps exact integer boundaries (factor exactly k counts as safe)", () => {
    // long 100/95, m 0: 9x liquidates at exactly 90 -> factor (100-90)/(100-95) = 2
    expect(maxLeverageForFactor(100, 95, 2, 0, "long")).toBe(9);
    // short 100/110, m 0: 6x liquidates at exactly 120 -> factor (120-100)/(110-100) = 2
    expect(maxLeverageForFactor(100, 110, 2, 0, "short")).toBe(6);
  });

  it("maxLeverageForFactor at 1e308 is never more permissive than at normal prices", () => {
    const scale = 1e308 / 81005.9;
    expect(maxLeverageForFactor(1e308, 79205.2 * scale, 2, 0.004, "long")).toBe(19);
    // At 1e308 the short liquidation overflows; an unrepresentable liquidation must not count as safe.
    const normal = maxLeverageForFactor(100, 150, 2, 0.004, "short");
    expect(normal).toBe(1);
    expect(maxLeverageForFactor(1e308, 1.5e308, 2, 0.004, "short") ?? 0).toBeLessThanOrEqual(normal!);
    // stop/entry overflows (1e250 / 1e-100): still search all leverages; short 1x with m 0 has no liquidation.
    expect(maxLeverageForFactor(1e-100, 1e250, 2, 0, "short")).toBe(1);
  });
});

describe("liquidationFactor", () => {
  it("is the liquidation distance in multiples of the stop distance (long)", () => {
    expectRel(liquidationFactor("long", ENTRY, STOP, 78697.44), 1.28, 0.005);
    expect(liquidationFactor("long", ENTRY, STOP, STOP)).toBeCloseTo(1, 12);
  });

  it("is negative when the liquidation lies on the wrong side of entry", () => {
    expect(liquidationFactor("long", ENTRY, STOP, 82000)).toBeLessThan(0);
    expect(liquidationFactor("short", ENTRY, 82806.6, 80000)).toBeLessThan(0);
  });

  it("is Infinity when there is no liquidation", () => {
    expect(liquidationFactor("short", ENTRY, 82806.6, Infinity)).toBe(Infinity);
  });
});

describe("maxLeverageForFactor", () => {
  it("long spec case with k = 2 is 19x", () => {
    expect(maxLeverageForFactor(ENTRY, STOP, 2, MMR, "long")).toBe(19);
  });

  it("long result is the highest leverage that still keeps factor >= k", () => {
    const L = maxLeverageForFactor(ENTRY, STOP, 2, MMR, "long");
    expect(L).not.toBeNull();
    const at = liquidationFactor("long", ENTRY, STOP, liquidationPriceLong(ENTRY, L!, MMR));
    const above = liquidationFactor("long", ENTRY, STOP, liquidationPriceLong(ENTRY, L! + 1, MMR));
    expect(at).toBeGreaterThanOrEqual(2);
    expect(above).toBeLessThan(2);
  });

  it("short (symmetric stop) result keeps factor >= k and the next leverage does not", () => {
    const shortStop = ENTRY + (ENTRY - STOP);
    const L = maxLeverageForFactor(ENTRY, shortStop, 2, MMR, "short");
    expect(L).not.toBeNull();
    expect(L).toBeGreaterThanOrEqual(1);
    expect(L).toBeLessThanOrEqual(MAX_LEVERAGE);
    const at = liquidationFactor("short", ENTRY, shortStop, liquidationPriceShort(ENTRY, L!, MMR));
    const above = liquidationFactor(
      "short",
      ENTRY,
      shortStop,
      liquidationPriceShort(ENTRY, L! + 1, MMR),
    );
    expect(at).toBeGreaterThanOrEqual(2);
    expect(above).toBeLessThan(2);
  });

  it("short and long give similar leverage for a mirrored stop (sanity)", () => {
    const shortStop = ENTRY + (ENTRY - STOP);
    const long = maxLeverageForFactor(ENTRY, STOP, 2, MMR, "long")!;
    const short = maxLeverageForFactor(ENTRY, shortStop, 2, MMR, "short")!;
    expect(Math.abs(long - short)).toBeLessThanOrEqual(2);
  });

  it("returns null when the long target liquidation would be <= 0", () => {
    // targetLiq = 100 - 2 * 60 = -20
    expect(maxLeverageForFactor(100, 40, 2, MMR, "long")).toBeNull();
  });

  it("returns null when even 1x is not enough", () => {
    // targetLiq = 40; L = 40 / (100 - 40 * 0.996) ≈ 0.66
    expect(maxLeverageForFactor(100, 70, 2, MMR, "long")).toBeNull();
    // Short: targetLiq = 100 + 2 * 19900 = 39900; L = 39900 / (39900 * 1.004 - 100) ≈ 0.9985
    expect(maxLeverageForFactor(100, 20000, 2, MMR, "short")).toBeNull();
  });

  it("clamps very tight stops to the maximum leverage 50", () => {
    expect(maxLeverageForFactor(100000, 99990, 2, MMR, "long")).toBe(MAX_LEVERAGE);
    expect(maxLeverageForFactor(100000, 100010, 2, MMR, "short")).toBe(MAX_LEVERAGE);
  });

  it("short with m = 0 never reports 'auch 1x reicht nicht' (1x short cannot be liquidated)", () => {
    expect(liquidationPriceShort(100, 1, 0)).toBe(Infinity);
    expect(maxLeverageForFactor(100, 20000, 2, 0, "short")).toBe(1);
  });
});

describe("tpForCrv", () => {
  const SHORT_STOP = ENTRY + (ENTRY - STOP);
  const CRVS = [0.5, 1, 1.921919, 3, 10];

  /** CRV as defined by the app: gain per USD over loss per USD. */
  function crvOf(direction: "long" | "short", entry: number, stop: number, tp: number): number {
    return gainPerUsd(direction, entry, tp) / lossPerUsd(direction, entry, stop);
  }

  it.each(CRVS)("long round trip: CRV(entry, stop, tpForCrv(R)) ≈ R for R = %s", (r) => {
    const tp = tpForCrv("long", ENTRY, STOP, r);
    expect(tp).not.toBeNull();
    expect(Number.isFinite(tp!)).toBe(true);
    expectRel(crvOf("long", ENTRY, STOP, tp!), r, 1e-9);
  });

  it.each(CRVS)("short round trip: CRV(entry, stop, tpForCrv(R)) ≈ R for R = %s", (r) => {
    const tp = tpForCrv("short", ENTRY, SHORT_STOP, r);
    expect(tp).not.toBeNull();
    expect(Number.isFinite(tp!)).toBe(true);
    expectRel(crvOf("short", ENTRY, SHORT_STOP, tp!), r, 1e-9);
  });

  it("Fall A long 81005.9 / 79205.2 with R = 1.921919 gives TP ≈ 84707.1", () => {
    expectRel(tpForCrv("long", ENTRY, STOP, 1.921919)!, TP, 1e-6);
  });

  it.each(CRVS)("TP lies beyond entry on the profit side (R = %s)", (r) => {
    const longTp = tpForCrv("long", ENTRY, STOP, r)!;
    const shortTp = tpForCrv("short", ENTRY, SHORT_STOP, r)!;
    expect(longTp).toBeGreaterThan(ENTRY);
    expect(shortTp).toBeLessThan(ENTRY);
    expect(shortTp).toBeGreaterThan(0);
  });

  it("TP moves further from entry as R grows", () => {
    const longs = CRVS.map((r) => tpForCrv("long", ENTRY, STOP, r)!);
    const shorts = CRVS.map((r) => tpForCrv("short", ENTRY, SHORT_STOP, r)!);
    for (let i = 1; i < CRVS.length; i++) {
      expect(longs[i]).toBeGreaterThan(longs[i - 1]);
      expect(shorts[i]).toBeLessThan(shorts[i - 1]);
    }
  });

  it("long is infeasible for R >= stop / (entry - stop): entry 100, stop 50 (bound 1)", () => {
    expect(tpForCrv("long", 100, 50, 1)).toBeNull();
    expect(tpForCrv("long", 100, 50, 2)).toBeNull();
    expect(tpForCrv("long", 100, 50, 1000)).toBeNull();
  });

  it("long just below the feasibility bound returns a finite TP with the target CRV", () => {
    const r = 0.999;
    const tp = tpForCrv("long", 100, 50, r);
    expect(tp).not.toBeNull();
    expect(Number.isFinite(tp!)).toBe(true);
    expect(tp!).toBeGreaterThan(100);
    expectRel(crvOf("long", 100, 50, tp!), r, 1e-9);
  });

  it("Fall A long: just below the bound is finite, at/above the bound is null", () => {
    const bound = STOP / (ENTRY - STOP);
    const below = tpForCrv("long", ENTRY, STOP, bound * (1 - 1e-6));
    expect(below).not.toBeNull();
    expect(Number.isFinite(below!)).toBe(true);
    expect(below!).toBeGreaterThan(ENTRY);
    expect(tpForCrv("long", ENTRY, STOP, bound * (1 + 1e-6))).toBeNull();
    expect(tpForCrv("long", ENTRY, STOP, bound * 2)).toBeNull();
  });

  it("short stays feasible for very large R (TP approaches 0 from above)", () => {
    const tp = tpForCrv("short", 100, 150, 1e6);
    expect(tp).not.toBeNull();
    expect(tp!).toBeGreaterThan(0);
    expect(tp!).toBeLessThan(100);
    expectRel(crvOf("short", 100, 150, tp!), 1e6, 1e-9);
  });

  it.each([0, -1, -0.5, NaN, Infinity, -Infinity])("returns null for R = %s", (r) => {
    expect(tpForCrv("long", ENTRY, STOP, r)).toBeNull();
    expect(tpForCrv("short", ENTRY, SHORT_STOP, r)).toBeNull();
  });

  it("returns null when the stop equals entry", () => {
    expect(tpForCrv("long", ENTRY, ENTRY, 2)).toBeNull();
    expect(tpForCrv("short", ENTRY, ENTRY, 2)).toBeNull();
  });

  it("returns null when the stop is on the wrong side of entry", () => {
    // Long stop above entry, short stop below entry.
    expect(tpForCrv("long", ENTRY, SHORT_STOP, 2)).toBeNull();
    expect(tpForCrv("short", ENTRY, STOP, 2)).toBeNull();
  });

  it.each([
    [0, 50],
    [-100, 50],
    [100, 0],
    [100, -50],
    [0, 0],
    [-100, -150],
    [NaN, 50],
    [100, NaN],
  ])("returns null for non-positive or non-numeric entry/stop (entry %s, stop %s)", (entry, stop) => {
    expect(tpForCrv("long", entry, stop, 1)).toBeNull();
    expect(tpForCrv("short", entry, stop, 1)).toBeNull();
  });

  it("returns null for short with negative entry and stop that only look ordered", () => {
    expect(tpForCrv("short", -150, -100, 1)).toBeNull();
  });
});

describe("tpForCrv exact long feasibility bound", () => {
  // stop / (entry - stop) is exactly representable here, so R equal to it must be rejected rather
  // than producing a huge bogus TP from `1/entry - R * loss` cancelling to float noise.
  it.each([
    [100000, 80000, 4],
    [100, 60, 1.5],
    [108000, 105500, 42.2],
  ])("long entry %s, stop %s: R = %s (the bound) is null", (entry, stop, bound) => {
    expect(stop / (entry - stop)).toBe(bound);
    expect(tpForCrv("long", entry, stop, bound)).toBeNull();
  });

  it.each([
    [100000, 80000, 4],
    [100, 60, 1.5],
    [108000, 105500, 42.2],
  ])("long entry %s, stop %s: R just below %s is a finite TP beyond entry", (entry, stop, bound) => {
    const r = bound * (1 - 1e-4);
    const tp = tpForCrv("long", entry, stop, r);
    expect(tp).not.toBeNull();
    expect(Number.isFinite(tp!)).toBe(true);
    expect(tp!).toBeGreaterThan(entry);
    expectRel(crvFromPrices("long", entry, stop, tp!)!, r, 1e-6);
  });
});

describe("maxReachableCrv", () => {
  // Exclusive long bound stop / (entry − stop): 105500 / 2500 = 42.2, 70 / 30 = 7/3, 80000 / 20000 = 4.
  it.each([
    [108000, 105500, 42.2],
    [100, 70, 70 / 30],
    [100000, 80000, 4],
    [100100, 100000, 1000],
  ])("long entry %s, stop %s: bound is %s", (entry, stop, bound) => {
    expect(maxReachableCrv("long", entry, stop)).toBe(bound);
  });

  it("long 100/70 is 2.333…", () => {
    expect(maxReachableCrv("long", 100, 70)).toBeCloseTo(2.3333333333, 9);
  });

  it.each([
    [108000, 110500],
    [100, 150],
    [0.1, 1],
  ])("short entry %s, stop %s: unbounded (null)", (entry, stop) => {
    expect(maxReachableCrv("short", entry, stop)).toBeNull();
  });

  it.each([
    ["long", 108000, 108000],
    ["long", 108000, 110500],
    ["long", 108000, 0],
    ["long", 108000, -1],
    ["long", 0, 50],
    ["long", NaN, 50],
    ["long", 100, NaN],
    ["long", Infinity, 50],
    ["long", 100, -Infinity],
    ["short", 108000, 108000],
    ["short", 108000, 105500],
    ["short", -150, -100],
  ] as const)("%s entry %s, stop %s: unusable stop gives null", (direction, entry, stop) => {
    expect(maxReachableCrv(direction, entry, stop)).toBeNull();
  });

  it("tpForCrv: below the bound gives a TP, exactly at and above it gives null (long 100/70)", () => {
    // Exact: 1 / (1/100 − 2.3 · (1/70 − 1/100)) = 7000.
    expect(tpForCrv("long", 100, 70, 2.3)).toBeCloseTo(7000, 6);
    expect(tpForCrv("long", 100, 70, 70 / 30)).toBeNull();
    expect(tpForCrv("long", 100, 70, 2.34)).toBeNull();
    expect(tpOnTickForCrv("long", 100, 70, 70 / 30, 1)).toBeNull();
  });

  it("tpForCrv: exactly at the bound 42.2 is null, just below is finite (long 108000/105500)", () => {
    expect(tpForCrv("long", 108000, 105500, 42.2)).toBeNull();
    expect(tpOnTickForCrv("long", 108000, 105500, 42.2, 1)).toBeNull();
    // Exact: 105500 · 108000 / (105500 − 42.19 · 2500) = 455760000.
    expect(tpForCrv("long", 108000, 105500, 42.19)).toBeCloseTo(455760000, 0);
  });
});

describe("validLossPerUsd", () => {
  it("equals lossPerUsd for a usable long and short stop", () => {
    expect(validLossPerUsd("long", ENTRY, STOP)).toBe(lossPerUsd("long", ENTRY, STOP));
    expect(validLossPerUsd("short", ENTRY, 82806.6)).toBe(lossPerUsd("short", ENTRY, 82806.6));
    expect(validLossPerUsd("long", ENTRY, STOP)!).toBeGreaterThan(0);
  });

  it("is null when a stop next to entry cancels the loss to 0 (long 13 / 12.999999999999998)", () => {
    expect(12.999999999999998).toBeLessThan(13);
    expect(validLossPerUsd("long", 13, 12.999999999999998)).toBeNull();
    expect(tpForCrv("long", 13, 12.999999999999998, 1)).toBeNull();
    expect(crvFromPrices("long", 13, 12.999999999999998, 14)).toBeNull();
  });

  it("is null for a stop on the wrong side of entry or equal to entry", () => {
    expect(validLossPerUsd("long", 100, 110)).toBeNull();
    expect(validLossPerUsd("short", 100, 90)).toBeNull();
    expect(validLossPerUsd("long", 100, 100)).toBeNull();
    expect(validLossPerUsd("short", 100, 100)).toBeNull();
  });

  it.each([
    [Infinity, 50],
    [100, Infinity],
    [NaN, 50],
    [100, NaN],
    [-Infinity, 50],
    [0, 50],
    [100, 0],
    [-100, -150],
  ])("is null for non-finite or non-positive prices (entry %s, stop %s)", (entry, stop) => {
    expect(validLossPerUsd("long", entry, stop)).toBeNull();
    expect(validLossPerUsd("short", entry, stop)).toBeNull();
  });
});

describe("crvFromPrices", () => {
  const SHORT_STOP = 82806.6;
  const SHORT_TP = 77304.7;

  it("is gainPerUsd / lossPerUsd for a long", () => {
    const expected = gainPerUsd("long", ENTRY, TP) / lossPerUsd("long", ENTRY, STOP);
    expect(crvFromPrices("long", ENTRY, STOP, TP)).toBe(expected);
    expectRel(crvFromPrices("long", ENTRY, STOP, TP)!, 1.921919, 1e-6);
  });

  it("is gainPerUsd / lossPerUsd for a short", () => {
    const expected = gainPerUsd("short", ENTRY, SHORT_TP) / lossPerUsd("short", ENTRY, SHORT_STOP);
    expect(crvFromPrices("short", ENTRY, SHORT_STOP, SHORT_TP)).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });

  it("is null for a stop on the wrong side of entry or equal to entry", () => {
    expect(crvFromPrices("long", ENTRY, SHORT_STOP, TP)).toBeNull();
    expect(crvFromPrices("short", ENTRY, STOP, SHORT_TP)).toBeNull();
    expect(crvFromPrices("long", ENTRY, ENTRY, TP)).toBeNull();
    expect(crvFromPrices("short", ENTRY, ENTRY, SHORT_TP)).toBeNull();
  });

  it("is null for a TP on the wrong side of entry or equal to entry", () => {
    expect(crvFromPrices("long", ENTRY, STOP, SHORT_TP)).toBeNull();
    expect(crvFromPrices("short", ENTRY, SHORT_STOP, TP)).toBeNull();
    expect(crvFromPrices("long", ENTRY, STOP, ENTRY)).toBeNull();
    expect(crvFromPrices("short", ENTRY, SHORT_STOP, ENTRY)).toBeNull();
  });

  it.each([0, -1, -84707.1, NaN, -Infinity])("is null for TP %s", (tp) => {
    expect(crvFromPrices("long", ENTRY, STOP, tp)).toBeNull();
    expect(crvFromPrices("short", ENTRY, SHORT_STOP, tp)).toBeNull();
  });

  it("is null for an infinite TP (documented: `tp` must be a finite price beyond entry)", () => {
    expect(crvFromPrices("short", ENTRY, SHORT_STOP, Infinity)).toBeNull();
    expect(crvFromPrices("long", ENTRY, STOP, Infinity)).toBeNull();
  });

  it.each([
    [0, 50],
    [-100, 50],
    [100, 0],
    [100, -50],
    [-100, -150],
    [NaN, 50],
    [100, Infinity],
  ])("is null for non-positive or non-finite entry/stop (entry %s, stop %s)", (entry, stop) => {
    expect(crvFromPrices("long", entry, stop, 200)).toBeNull();
    expect(crvFromPrices("short", entry, stop, 25)).toBeNull();
  });

  it.each([0.25, 1, 1.921919, 3, 7.5])("round trips with tpForCrv for R = %s (long and short)", (r) => {
    const longTp = tpForCrv("long", ENTRY, STOP, r)!;
    const shortTp = tpForCrv("short", ENTRY, SHORT_STOP, r)!;
    expectRel(crvFromPrices("long", ENTRY, STOP, longTp)!, r, 1e-9);
    expectRel(crvFromPrices("short", ENTRY, SHORT_STOP, shortTp)!, r, 1e-9);
  });
});

describe("tpOnTickForCrv", () => {
  const SHORT_STOP = 82806.6;
  const CRVS = [0.1, 0.5, 1, 1.4, 1.921919, 2.3, 3, 5.7, 10];

  /** True when `price` is exactly the double for some multiple of 0.1. */
  function onTenthTick(price: number): boolean {
    return Math.round(price * 10) / 10 === price;
  }

  /** Targets 0.1 apart from `from` to `to` inclusive, as a keyboard-stepped slider produces them. */
  function targets(from: number, to: number): number[] {
    const out: number[] = [];
    for (let i = Math.round(from * 10); i <= Math.round(to * 10); i++) out.push(i / 10);
    return out;
  }

  it.each(CRVS)("long R = %s: on the 0.1 tick and above entry", (r) => {
    const tp = tpOnTickForCrv("long", ENTRY, STOP, r, 1);
    expect(tp).not.toBeNull();
    expect(onTenthTick(tp!), `${tp} on 0.1 tick`).toBe(true);
    expect(tp!).toBeGreaterThan(ENTRY);
  });

  it.each(CRVS)("short R = %s: on the 0.1 tick, below entry and positive", (r) => {
    const tp = tpOnTickForCrv("short", ENTRY, SHORT_STOP, r, 1);
    expect(tp).not.toBeNull();
    expect(onTenthTick(tp!), `${tp} on 0.1 tick`).toBe(true);
    expect(tp!).toBeLessThan(ENTRY);
    expect(tp!).toBeGreaterThan(0);
  });

  it.each(CRVS)("R = %s: equals tpForCrv rounded to the nearest 0.1 tick (long and short)", (r) => {
    const longExact = tpForCrv("long", ENTRY, STOP, r)!;
    const shortExact = tpForCrv("short", ENTRY, SHORT_STOP, r)!;
    const longTick = tpOnTickForCrv("long", ENTRY, STOP, r, 1)!;
    const shortTick = tpOnTickForCrv("short", ENTRY, SHORT_STOP, r, 1)!;
    expect(longTick).toBe(Math.round(longExact * 10) / 10);
    expect(shortTick).toBe(Math.round(shortExact * 10) / 10);
    // Nearest tick: never more than half a tick away from the exact price.
    expect(Math.abs(longTick - longExact)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(Math.abs(shortTick - shortExact)).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it("examples: Fall A 1.921919 -> 84707.1, long 108000 / 105500 R 3 -> 116265.3, short 108000 / 110500 R 2 -> 103324.7", () => {
    expect(tpOnTickForCrv("long", ENTRY, STOP, 1.921919, 1)).toBe(84707.1);
    expect(tpOnTickForCrv("long", 108000, 105500, 3, 1)).toBe(116265.3);
    expect(tpOnTickForCrv("short", 108000, 110500, 2, 1)).toBe(103324.7);
  });

  it("long 100 / 60 with R 1.5 (exactly the feasibility bound) is null", () => {
    expect(tpOnTickForCrv("long", 100, 60, 1.5, 1)).toBeNull();
  });

  it("is deterministic: the same arguments always give the same result", () => {
    const cases: [Parameters<typeof tpOnTickForCrv>[0], number, number][] = [
      ["long", ENTRY, STOP],
      ["short", ENTRY, SHORT_STOP],
      ["long", 108000, 107999.9],
      ["short", 108000, 108000.1],
    ];
    for (const [direction, entry, stop] of cases) {
      for (const r of [0.01, 1.1, 1.4, 1.921919, 3]) {
        const first = tpOnTickForCrv(direction, entry, stop, r, 1);
        // Interleave other calls (different targets, other direction) before repeating.
        tpOnTickForCrv(direction, entry, stop, r + 0.7, 1);
        tpOnTickForCrv(direction === "long" ? "short" : "long", ENTRY, direction === "long" ? SHORT_STOP : STOP, r, 1);
        expect(tpOnTickForCrv(direction, entry, stop, r, 1)).toBe(first);
        expect(tpOnTickForCrv(direction, entry, stop, r, 1)).toBe(first);
      }
    }
  });

  it("long: TP is non-decreasing as the target grows (Fall A, 0.1 .. 10)", () => {
    const tps = targets(0.1, 10).map((r) => tpOnTickForCrv("long", ENTRY, STOP, r, 1));
    for (let i = 1; i < tps.length; i++) {
      expect(tps[i]).not.toBeNull();
      expect(tps[i]!).toBeGreaterThanOrEqual(tps[i - 1]!);
    }
  });

  it("short: TP is non-increasing as the target grows (Fall A mirror, 0.1 .. 10)", () => {
    const tps = targets(0.1, 10).map((r) => tpOnTickForCrv("short", ENTRY, SHORT_STOP, r, 1));
    for (let i = 1; i < tps.length; i++) {
      expect(tps[i]).not.toBeNull();
      expect(tps[i]!).toBeLessThanOrEqual(tps[i - 1]!);
    }
  });

  it("tight-stop long 108000 / 107999.9: non-decreasing over 1 .. 30, targets 1.1 .. 1.4 all give 108000.1", () => {
    const tps = targets(1, 30).map((r) => tpOnTickForCrv("long", 108000, 107999.9, r, 1));
    for (let i = 1; i < tps.length; i++) {
      expect(tps[i]).not.toBeNull();
      expect(onTenthTick(tps[i]!)).toBe(true);
      expect(tps[i]!).toBeGreaterThanOrEqual(tps[i - 1]!);
    }
    for (const r of [1.1, 1.2, 1.3, 1.4]) {
      expect(tpOnTickForCrv("long", 108000, 107999.9, r, 1), `R ${r}`).toBe(108000.1);
    }
  });

  it("tight-stop short 108000 / 108000.1: non-increasing over 1 .. 30, targets 1.1 .. 1.4 all give 107999.9", () => {
    const tps = targets(1, 30).map((r) => tpOnTickForCrv("short", 108000, 108000.1, r, 1));
    for (let i = 1; i < tps.length; i++) {
      expect(tps[i]).not.toBeNull();
      expect(onTenthTick(tps[i]!)).toBe(true);
      expect(tps[i]!).toBeLessThanOrEqual(tps[i - 1]!);
    }
    for (const r of [1.1, 1.2, 1.3, 1.4]) {
      expect(tpOnTickForCrv("short", 108000, 108000.1, r, 1), `R ${r}`).toBe(107999.9);
    }
  });

  it("is null when tpForCrv is infeasible", () => {
    expect(tpOnTickForCrv("long", 100000, 80000, 4, 1)).toBeNull();
    expect(tpOnTickForCrv("long", 100, 50, 2, 1)).toBeNull();
    expect(tpOnTickForCrv("long", ENTRY, ENTRY, 1, 1)).toBeNull();
    expect(tpOnTickForCrv("short", ENTRY, STOP, 1, 1)).toBeNull();
    expect(tpOnTickForCrv("long", 13, 12.999999999999998, 1, 1)).toBeNull();
    expect(tpOnTickForCrv("long", ENTRY, STOP, 0, 1)).toBeNull();
    expect(tpOnTickForCrv("long", ENTRY, STOP, NaN, 1)).toBeNull();
    expect(tpOnTickForCrv("short", ENTRY, SHORT_STOP, -1, 1)).toBeNull();
  });

  it("is null when the rounded TP would land on entry", () => {
    // Exact TP ≈ 108000.001 rounds to entry itself, which is not beyond entry.
    expect(tpForCrv("long", 108000, 107999.9, 0.01)).not.toBeNull();
    expect(tpOnTickForCrv("long", 108000, 107999.9, 0.01, 1)).toBeNull();
    expect(tpForCrv("short", 108000, 108000.1, 0.01)).not.toBeNull();
    expect(tpOnTickForCrv("short", 108000, 108000.1, 0.01, 1)).toBeNull();
  });
});
