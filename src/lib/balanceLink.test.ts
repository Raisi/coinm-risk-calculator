import { describe, expect, it } from "vitest";
import {
  balanceRate,
  balanceRateHint,
  convertBalance,
  linkBalance,
  typedBalanceField,
  type BalanceField,
} from "./balanceLink";
import { DEFAULT_INPUTS, type RawInputs } from "./evaluate";
import { parseNumber } from "./format";
import { LIVE_PRICE_SOURCE } from "./livePrice";

/** Plain dot decimal: no grouping, no exponent, no sign, no trailing zeros. */
const PLAIN_DECIMAL = /^(0|[1-9]\d*)(\.\d*[1-9])?$/;

/** 10^`exponent` as a BigInt (test oracle). */
function ten(exponent: number): bigint {
  return BigInt(10) ** BigInt(exponent);
}

/**
 * Exact value of a decimal string ("2453.229", "1.5e-7", "1e+21") as `units / 10^scale` (test oracle,
 * independent of the production helpers).
 */
function exactOf(text: string): { units: bigint; scale: number } {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text);
  if (!match) throw new Error(`not a decimal: ${text}`);
  const [, whole, fraction = "", exponent = "0"] = match;
  const scale = fraction.length - Number(exponent);
  const units = BigInt(whole + fraction);
  return scale >= 0 ? { units, scale } : { units: units * ten(-scale), scale: 0 };
}

// Expected values at 81774.3 USDT per BTC, always rounded DOWN (truncated):
//   BTC → USDT, 2 decimals: 0.123456 → 10095.5279808 → 10095.52 (rounding would give .53)
//   USDT → BTC, 8 decimals: 50000 → 0.61143904625… → 0.61143904 (rounding would give …05)
const PRICE = 81774.3;

describe("convertBalance – BTC → USDT", () => {
  it.each<[string, string]>([
    ["0.5", "40887.15"],
    ["1", "81774.3"],
    ["2", "163548.6"],
    ["0.1", "8177.43"],
    // 9812.916 and 10090.94862: truncated, not rounded up.
    ["0.12", "9812.91"],
    ["0.1234", "10090.94"],
    ["0.123456", "10095.52"],
    // 1.23456789 → 100955.925007227
    ["1.23456789", "100955.92"],
    // 5724.201 exactly: the digit below the cent is dropped, as are trailing zeros.
    ["0.07", "5724.2"],
  ])("%s BTC → %s USDT", (btc, usdt) => {
    expect(convertBalance("balance", btc, PRICE)).toBe(usdt);
  });

  it("an exact step value stays on its step despite float noise", () => {
    // 0.1 × 3 = 0.30000000000000004 in floats.
    expect(convertBalance("balance", "0.1", 3)).toBe("0.3");
    expect(convertBalance("balance", "0.5", 90000)).toBe("45000");
  });
});

describe("convertBalance – USDT → BTC", () => {
  it.each<[string, string]>([
    ["40887.15", "0.5"],
    ["1000", "0.01222878"],
    ["500", "0.00611439"],
    // 0.06114390462…: trailing zero dropped.
    ["5000", "0.0611439"],
    // 0.61143904625… and 0.00122287809…: truncated, not rounded up.
    ["50000", "0.61143904"],
    ["100", "0.00122287"],
    ["777", "0.00950176"],
    // 1.2228…e-8 and 1.2228…e-7: written out, never in exponent form.
    ["0.001", "0.00000001"],
    ["0.01", "0.00000012"],
  ])("%s USDT → %s BTC", (usdt, btc) => {
    expect(convertBalance("balanceUsdt", usdt, PRICE)).toBe(btc);
  });

  it("50000 USDT at 100000 → 0.5 BTC", () => {
    expect(convertBalance("balanceUsdt", "50000", 100000)).toBe("0.5");
  });
});

describe("convertBalance – input formats", () => {
  it("accepts German and dot-decimal input alike", () => {
    expect(convertBalance("balance", "0,5", PRICE)).toBe("40887.15");
    expect(convertBalance("balance", " 0,5 ", PRICE)).toBe("40887.15");
    expect(convertBalance("balance", "0.5", PRICE)).toBe("40887.15");
    expect(convertBalance("balanceUsdt", "1.000,00", PRICE)).toBe("0.01222878");
    expect(convertBalance("balanceUsdt", "1000", PRICE)).toBe("0.01222878");
    expect(convertBalance("balanceUsdt", "1000.0", PRICE)).toBe("0.01222878");
  });

  it("a dot without a comma is a decimal point, not a thousands separator", () => {
    // "1.000" is 1 USDT: 1 / 81774.3 = 0.0000122287…
    expect(convertBalance("balanceUsdt", "1.000", PRICE)).toBe("0.00001222");
  });
});

describe("convertBalance – unusable input gives an empty result", () => {
  const unusable = ["", "   ", "abc", "1e5", "0", "0,00", "0.", "-1", "-0.5", "+-1", "1,2,3", "NaN", "Infinity"];

  it.each(unusable)("source %j → \"\" in both directions", (text) => {
    expect(convertBalance("balance", text, PRICE)).toBe("");
    expect(convertBalance("balanceUsdt", text, PRICE)).toBe("");
  });

  it.each([0, -0, -1, -PRICE, Number.NaN, Number.NEGATIVE_INFINITY])("price %s → \"\" in both directions", (price) => {
    expect(convertBalance("balance", "0.5", price)).toBe("");
    expect(convertBalance("balanceUsdt", "1000", price)).toBe("");
  });

  it("an infinite price gives \"\" in both directions (overflow and underflow to 0)", () => {
    expect(convertBalance("balance", "0.5", Number.POSITIVE_INFINITY)).toBe("");
    expect(convertBalance("balanceUsdt", "1000", Number.POSITIVE_INFINITY)).toBe("");
  });

  it("an overflowing result gives \"\", never \"Infinity\"", () => {
    // 1e305 BTC parses as finite; × 81774.3 overflows.
    const hugeBtc = `1${"0".repeat(305)}`;
    expect(parseNumber(hugeBtc)).not.toBeNull();
    expect(convertBalance("balance", hugeBtc, PRICE)).toBe("");
    // 1e10 USDT ÷ 1e-300 overflows.
    expect(convertBalance("balanceUsdt", "10000000000", 1e-300)).toBe("");
  });

  it("a result rounding down to 0 gives \"\", never \"0\"", () => {
    // 0.000001 / 81774.3 = 1.2e-11 BTC, below 1 sat.
    expect(convertBalance("balanceUsdt", "0.000001", PRICE)).toBe("");
    // 0.00000999 × 1 = 0.00000999 USDT, below 1 cent.
    expect(convertBalance("balance", "0.00000999", 1)).toBe("");
    // Just above the step is kept.
    expect(convertBalance("balance", "0.01", 1)).toBe("0.01");
    expect(convertBalance("balanceUsdt", "0.00000001", 1)).toBe("0.00000001");
  });
});

describe("convertBalance – output is a plain dot decimal", () => {
  it.each<["balance" | "balanceUsdt", string, number, string]>([
    // 1e21 × 81774.3 = 8.17743e25: written out in full.
    ["balance", "1000000000000000000000", PRICE, "81774300000000000000000000"],
    ["balance", "1000000000", PRICE, "81774300000000"],
    // 1.2228…e-7: written out, never in exponent form.
    ["balanceUsdt", "0.01", PRICE, "0.00000012"],
    ["balanceUsdt", "1000000000000000000000000", 1, "1000000000000000000000000"],
  ])("%s %s at %s → %s", (from, text, price, expected) => {
    const result = convertBalance(from, text, price);
    expect(result).toBe(expected);
    expect(result).toMatch(PLAIN_DECIMAL);
  });

  it("every result over a sweep is a plain decimal, never above the exact value and less than one step below it", () => {
    // Oracle independent of the production helpers: exact BigInt fractions over the decimal strings.
    // Each price string is its number's shortest round-trip form (≤ 15 significant digits), so it is
    // exactly the decimal that number stands for; `dot` is the typed text in dot-decimal form.
    const prices = ["1e-7", "1.5e-7", "0.1", "0.5", "1", "3", "7.77", "65432.1", "81774.3", "123456.7", "1e+21"];
    const texts: { text: string; dot: string }[] = [
      { text: "0.00000001", dot: "0.00000001" },
      { text: "0.0000005", dot: "0.0000005" },
      { text: "0,3", dot: "0.3" },
      { text: "0.7", dot: "0.7" },
      { text: "0.9", dot: "0.9" },
      { text: "1", dot: "1" },
      { text: "1,15", dot: "1.15" },
      { text: "12.345", dot: "12.345" },
      { text: "999.99", dot: "999.99" },
      { text: "1.234,56", dot: "1234.56" },
      { text: "2.453,229", dot: "2453.229" },
      { text: "19629.63", dot: "19629.63" },
      { text: "123456789", dot: "123456789" },
    ];
    let onStep = 0;
    for (const priceText of prices) {
      const price = Number(priceText);
      expect(String(price)).toBe(priceText);
      const p = exactOf(priceText);
      for (const { text, dot } of texts) {
        expect(parseNumber(text)).toBe(Number(dot));
        const v = exactOf(dot);
        // Exact result as the fraction num / den.
        for (const [from, num, den, decimals] of [
          ["balance", v.units * p.units, ten(v.scale + p.scale), 2],
          ["balanceUsdt", v.units * ten(p.scale), p.units * ten(v.scale), 8],
        ] as const) {
          const label = `${text} ${from} at ${priceText}`;
          const result = convertBalance(from, text, price);
          // exact × 10^decimals < 1 ⟺ below one step.
          const belowStep = num * ten(decimals) < den;
          if ((num * ten(decimals)) % den === BigInt(0)) onStep++;
          if (result === "") {
            expect(belowStep, label).toBe(true);
            continue;
          }
          expect(result, label).toMatch(PLAIN_DECIMAL);
          expect(parseNumber(result), label).not.toBeNull();
          // result = r / 10^scale; compare result and exact as num·10^scale vs r·den.
          const r = exactOf(result);
          const exactScaled = num * ten(r.scale);
          const resultScaled = r.units * den;
          expect(resultScaled <= exactScaled, `${label}: ${result} exceeds the exact value`).toBe(true);
          // (exact − result) × 10^decimals < 1, i.e. less than one step below.
          expect((exactScaled - resultScaled) * ten(decimals) < den * ten(r.scale), `${label}: ${result} is a step low`).toBe(true);
          expect(r.scale, label).toBeLessThanOrEqual(decimals);
        }
      }
    }
    // The sweep includes exact step results, where float arithmetic lands one step low.
    expect(onStep).toBeGreaterThan(20);
  });
});

describe("convertBalance – exact decimal arithmetic (no float rounding at step boundaries)", () => {
  it.each<[BalanceField, string, number, string]>([
    // 0.3 × 65432.1 = 19629.63 exactly (float: 19629.629999999997).
    ["balance", "0.3", 65432.1, "19629.63"],
    ["balance", "0,3", 65432.1, "19629.63"],
    // 0.3 × 3 = 0.9 (float: 0.8999999999999999).
    ["balance", "0.3", 3, "0.9"],
    // 0.7 × 0.1 = 0.07 (float: 0.06999999999999999).
    ["balance", "0.7", 0.1, "0.07"],
    // 1.15 × 100 = 115 (float: 114.99999999999999).
    ["balance", "1.15", 100, "115"],
    ["balance", "1,15", 100, "115"],
    // 2453.229 ÷ 81774.3 = 0.03 exactly (float: 0.029999999999999995).
    ["balanceUsdt", "2453.229", 81774.3, "0.03"],
    ["balanceUsdt", "2.453,229", 81774.3, "0.03"],
    // 0.7 ÷ 0.1 = 7 (float: 6.999999999999999).
    ["balanceUsdt", "0.7", 0.1, "7"],
    ["balanceUsdt", "0,7", 0.1, "7"],
    // 19629.63 ÷ 65432.1 = 0.3 (float: 0.30000000000000004, harmless here, but exact either way).
    ["balanceUsdt", "19.629,63", 65432.1, "0.3"],
    // 0.000817743 ÷ 81774.3 = exactly 1 sat.
    ["balanceUsdt", "0.000817743", 81774.3, "0.00000001"],
  ])("%s %s at %s → %s", (from, text, price, expected) => {
    expect(convertBalance(from, text, price)).toBe(expected);
  });

  it.each<[BalanceField, string, number, string]>([
    // 0.5 × 39259.258 = 19629.629 exactly: genuinely below 19629.63.
    ["balance", "0.5", 39259.258, "19629.62"],
    ["balance", "0,5", 39259.258, "19629.62"],
    // 0.3 × 65432.09999999 = 19629.629999997.
    ["balance", "0.3", 65432.09999999, "19629.62"],
    ["balance", "0,3", 65432.09999999, "19629.62"],
    // 2453.22899999 ÷ 81774.3 = 0.03 − 1.2…e-13: just below a satoshi step.
    ["balanceUsdt", "2453.22899999", 81774.3, "0.02999999"],
    ["balanceUsdt", "2.453,22899999", 81774.3, "0.02999999"],
    // 0.00081774299 ÷ 81774.3 = 1 sat − 1.2…e-16: below one satoshi, so nothing.
    ["balanceUsdt", "0.00081774299", 81774.3, ""],
    ["balanceUsdt", "0,00081774299", 81774.3, ""],
  ])("a value genuinely below a step still truncates down: %s %s at %s → %j", (from, text, price, expected) => {
    expect(convertBalance(from, text, price)).toBe(expected);
  });

  it.each<[BalanceField, string, number, string]>([
    // Values whose number string is in exponent form: 5e-7, 7e-7, 3e-7, 1.5e-7, 1e+21.
    ["balance", "0.0000005", 81774.3, "0.04"],
    ["balance", "0,0000005", 81774.3, "0.04"],
    ["balanceUsdt", "0.0000007", 1e-7, "7"],
    ["balanceUsdt", "0.0000003", 1.5e-7, "2"],
    ["balanceUsdt", "1", 5e-7, "2000000"],
    ["balance", "0.0000003", 1e21, "300000000000000"],
    ["balance", "0.00000015", 1e21, "150000000000000"],
    ["balance", "0.3", 1e21, "300000000000000000000"],
    // 3 ÷ 1e21 = 3e-21: below one satoshi.
    ["balanceUsdt", "3", 1e21, ""],
    // 1e21 ÷ 0.3 = 3333333333333333333333.33…: every digit exact (float: 3.3333333333333335e+21).
    ["balanceUsdt", "1000000000000000000000", 0.3, "3333333333333333333333.33333333"],
  ])("exponent-form value or price: %s %s at %s → %j", (from, text, price, expected) => {
    expect(convertBalance(from, text, price)).toBe(expected);
  });

  it.each([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN, 0, -0, -65432.1, -1e-7])(
    "price %s → \"\" in both directions, also for exact-step sources",
    (price) => {
      expect(convertBalance("balance", "0.3", price)).toBe("");
      expect(convertBalance("balanceUsdt", "2453.229", price)).toBe("");
    },
  );

  it("the smallest positive price: the product is below a cent, the quotient overflows → \"\"", () => {
    expect(convertBalance("balance", "1", Number.MIN_VALUE)).toBe("");
    expect(convertBalance("balanceUsdt", "1", Number.MIN_VALUE)).toBe("");
  });

  it("an overflowing product gives \"\"; the largest finite product is written out", () => {
    expect(convertBalance("balance", "2", Number.MAX_VALUE)).toBe("");
    expect(convertBalance("balance", "1,5", Number.MAX_VALUE)).toBe("");
    // 1.7976931348623157e308 in full: 17976931348623157 followed by 292 zeros.
    const max = convertBalance("balance", "1", Number.MAX_VALUE);
    expect(max).toBe(`17976931348623157${"0".repeat(292)}`);
    expect(Number(max)).toBe(Number.MAX_VALUE);
  });

  it("a huge finite quotient is plain digits, never exponent form", () => {
    // 1e300 USDT ÷ 0.001 = 1e303 BTC.
    const result = convertBalance("balanceUsdt", `1${"0".repeat(300)}`, 0.001);
    expect(result).toBe(`1${"0".repeat(303)}`);
    expect(result).toMatch(PLAIN_DECIMAL);
    expect(Number.isFinite(parseNumber(result))).toBe(true);
  });
});

describe("convertBalance – round trips are lossy, which is why the typed field is never rewritten", () => {
  it("converting a derived value back does not reproduce the typed one", () => {
    expect(convertBalance("balanceUsdt", "1000", PRICE)).toBe("0.01222878");
    expect(convertBalance("balance", "0.01222878", PRICE)).toBe("999.99");
    expect(convertBalance("balance", "0.123456", PRICE)).toBe("10095.52");
    expect(convertBalance("balanceUsdt", "10095.52", PRICE)).toBe("0.1234559");
  });
});

describe("linkBalance", () => {
  const inputs: RawInputs = {
    ...DEFAULT_INPUTS,
    account: "usdt",
    balance: "0,5",
    balanceUsdt: "1",
    entry: "108000",
    riskUsdt: "25",
  };

  it("BTC source: recomputes USDT and keeps the BTC text verbatim", () => {
    expect(linkBalance(inputs, "balance", PRICE)).toEqual({ ...inputs, balanceUsdt: "40887.15" });
  });

  it("USDT source: recomputes BTC and keeps the USDT text verbatim", () => {
    const usdt = { ...inputs, balanceUsdt: "1.000,00" };
    expect(linkBalance(usdt, "balanceUsdt", PRICE)).toEqual({ ...usdt, balance: "0.01222878" });
  });

  it("an unusable source or price empties the linked field and keeps the source", () => {
    expect(linkBalance({ ...inputs, balance: "abc" }, "balance", PRICE)).toEqual({ ...inputs, balance: "abc", balanceUsdt: "" });
    expect(linkBalance({ ...inputs, balanceUsdt: "" }, "balanceUsdt", PRICE)).toEqual({ ...inputs, balance: "", balanceUsdt: "" });
    expect(linkBalance(inputs, "balance", 0)).toEqual({ ...inputs, balanceUsdt: "" });
  });

  it("works on a bare balance pair and does not mutate its input", () => {
    const pair = Object.freeze({ balance: "2", balanceUsdt: "" });
    const linked = linkBalance(pair, "balance", PRICE);
    expect(linked).toEqual({ balance: "2", balanceUsdt: "163548.6" });
    expect(linked).not.toBe(pair);
    expect(pair).toEqual({ balance: "2", balanceUsdt: "" });
  });
});

describe("typedBalanceField", () => {
  it.each<[Partial<RawInputs>, "balance" | "balanceUsdt" | null]>([
    [{ balance: "0.5" }, "balance"],
    [{ balance: "" }, "balance"],
    [{ balanceUsdt: "1000" }, "balanceUsdt"],
    [{ balanceUsdt: "" }, "balanceUsdt"],
    [{ balance: "0.5", leverage: "20" }, "balance"],
    [{ balanceUsdt: "1000", account: "usdt" }, "balanceUsdt"],
    [{}, null],
    [{ account: "usdt" }, null],
    [{ entry: "108000", tp: "115000" }, null],
    [{ balance: "0.5", balanceUsdt: "1000" }, null],
    [{ balance: "", balanceUsdt: "" }, null],
  ])("%j → %s", (patch, field) => {
    expect(typedBalanceField(patch)).toBe(field);
  });
});

describe("balanceRate", () => {
  const receivedAt = new Date(2026, 9, 22, 23, 59, 58);

  it("keeps the price and the exchange time", () => {
    const time = new Date(2026, 9, 22, 11, 55, 8).getTime();
    expect(balanceRate({ price: PRICE, time }, receivedAt)).toEqual({ price: PRICE, time });
  });

  it("dates a quote without exchange time at its arrival", () => {
    expect(balanceRate({ price: PRICE, time: null }, receivedAt)).toEqual({ price: PRICE, time: receivedAt.getTime() });
  });
});

describe("balanceRateHint", () => {
  // Built from local-time components, so the expected clock text holds in every time zone.
  const time = new Date(2026, 9, 22, 11, 55, 8).getTime();

  it("shows the rate in de-DE, the source and the quote time", () => {
    expect(balanceRateHint({ price: PRICE, time })).toBe(`1 BTC = 81.774,3 USDT · ${LIVE_PRICE_SOURCE} · 11:55:08`);
  });

  it("shows at most 2 decimals and drops trailing zeros", () => {
    expect(balanceRateHint({ price: 90000, time })).toBe(`1 BTC = 90.000 USDT · ${LIVE_PRICE_SOURCE} · 11:55:08`);
    expect(balanceRateHint({ price: 81774.35, time })).toBe(`1 BTC = 81.774,35 USDT · ${LIVE_PRICE_SOURCE} · 11:55:08`);
    expect(balanceRateHint({ price: 105432.1, time })).toBe(`1 BTC = 105.432,1 USDT · ${LIVE_PRICE_SOURCE} · 11:55:08`);
  });

  it("zero-pads the time", () => {
    const early = new Date(2026, 0, 5, 7, 3, 9).getTime();
    expect(balanceRateHint({ price: PRICE, time: early })).toBe(`1 BTC = 81.774,3 USDT · ${LIVE_PRICE_SOURCE} · 07:03:09`);
  });

  it("a quote without exchange time shows its arrival time", () => {
    const arrival = new Date(2026, 9, 22, 0, 0, 1);
    expect(balanceRateHint(balanceRate({ price: PRICE, time: null }, arrival))).toBe(
      `1 BTC = 81.774,3 USDT · ${LIVE_PRICE_SOURCE} · 00:00:01`,
    );
  });
});
