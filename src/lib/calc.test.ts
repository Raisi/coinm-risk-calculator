import { describe, expect, it } from "vitest";
import {
  approxPositionUsd,
  gainPerUsd,
  grossRiskBtc,
  liquidationFactor,
  liquidationPrice,
  liquidationPriceLong,
  liquidationPriceShort,
  lossPerUsd,
  MAX_LEVERAGE,
  maxLeverageForFactor,
  netRiskBtc,
  positionSize,
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
