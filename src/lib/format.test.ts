import { describe, expect, it } from "vitest";
import {
  buildJournalTsv,
  COPY_DECIMALS,
  exactDecimal,
  formatDe,
  formatDeCompact,
  formatLocalDateTime,
  parseNumber,
  toCopyValue,
  toPlainDecimal,
  unitsToPlainDecimal,
  type JournalRow,
} from "./format";

describe("parseNumber", () => {
  it.each([
    ["81.005,9", 81005.9],
    ["81005.9", 81005.9],
    ["0.00725346", 0.00725346],
    ["0,004", 0.004],
    ["0,00725346", 0.00725346],
    ["  81005.9  ", 81005.9],
    ["81 005,9", 81005.9],
    ["1.234.567,89", 1234567.89],
    ["5", 5],
    [",5", 0.5],
  ])("%j -> %f", (input, expected) => {
    expect(parseNumber(input)).toBe(expected);
  });

  it.each(["abc", "", "   ", "12abc", "1,2,3", "1.234.567", "Infinity", "NaN", ",", "."])(
    "%j is invalid",
    (input) => {
      expect(parseNumber(input)).toBeNull();
    },
  );
});

describe("toCopyValue (exchange copy values)", () => {
  it("position BTC is floored to 0.0001", () => {
    expect(toCopyValue(0.0154, COPY_DECIMALS.positionBtc)).toBe("0.0154");
    expect(toCopyValue(0.015395, COPY_DECIMALS.positionBtc)).toBe("0.0153");
    expect(toCopyValue(0.015952455989115363, COPY_DECIMALS.positionBtc)).toBe("0.0159");
    expect(toCopyValue(0.99999, COPY_DECIMALS.positionBtc)).toBe("0.9999");
  });

  it("position USD is floored to whole USD", () => {
    expect(toCopyValue(1292.9, COPY_DECIMALS.positionUsd)).toBe("1292");
    expect(toCopyValue(1292.9999, COPY_DECIMALS.positionUsd)).toBe("1292");
    expect(toCopyValue(1292, COPY_DECIMALS.positionUsd)).toBe("1292");
  });

  it("margin BTC is floored to 8 decimals", () => {
    expect(toCopyValue(0.0005317485329705121, COPY_DECIMALS.marginBtc)).toBe("0.00053174");
    expect(toCopyValue(0.00015, COPY_DECIMALS.marginBtc)).toBe("0.00015000");
  });

  it("is float-safe: binary noise below an exact step does not drop a step", () => {
    // 0.57 * 100 === 56.99999999999999, 4.35 * 100 === 434.99999999999994
    expect(toCopyValue(0.57, 2)).toBe("0.57");
    expect(toCopyValue(4.35, 2)).toBe("4.35");
    expect(toCopyValue(0.1 + 0.2, 1)).toBe("0.3");
    expect(toCopyValue(0.0154, 4)).toBe("0.0154");
  });

  it("uses dot decimal and no grouping", () => {
    expect(toCopyValue(123456.78, 0)).toBe("123456");
    expect(toCopyValue(1.5, 4)).toBe("1.5000");
  });

  it("never rounds up a value genuinely below a step (QA defect 1)", () => {
    expect(toCopyValue(1292.999999999, COPY_DECIMALS.positionUsd)).toBe("1292");
    expect(toCopyValue(0.015399999999999, COPY_DECIMALS.positionBtc)).toBe("0.0153");
    expect(toCopyValue(0.00053174999999999, COPY_DECIMALS.marginBtc)).toBe("0.00053174");
    expect(toCopyValue(12.92999999999, COPY_DECIMALS.positionBtc)).toBe("12.9299");
    expect(toCopyValue(1.292999999999, COPY_DECIMALS.marginBtc)).toBe("1.29299999");
  });

  it("exact large values keep their step (no upward drift at any magnitude, QA re-review B/C)", () => {
    expect(toCopyValue(2000000000000000, COPY_DECIMALS.positionUsd)).toBe("2000000000000000");
    expect(toCopyValue(123456789012, COPY_DECIMALS.positionBtc)).toBe("123456789012.0000");
    expect(toCopyValue(1000000000000, COPY_DECIMALS.positionBtc)).toBe("1000000000000.0000");
    expect(toCopyValue(2090667504201.3953, COPY_DECIMALS.positionBtc)).toBe("2090667504201.3953");
    expect(toCopyValue(100000000000, COPY_DECIMALS.marginBtc)).toBe("100000000000.00000000");
  });

  it("values a few ULPs below a step round down (QA re-review A)", () => {
    expect(toCopyValue(1292.999999999999, COPY_DECIMALS.positionUsd)).toBe("1292");
    expect(toCopyValue(12.92999999999999, COPY_DECIMALS.positionBtc)).toBe("12.9299");
    expect(toCopyValue(1.292999999999999, COPY_DECIMALS.marginBtc)).toBe("1.29299999");
    // The largest double below 1293 is 1292.9999999999998.
    expect(toCopyValue(1292.9999999999998, COPY_DECIMALS.positionUsd)).toBe("1292");
  });

  it("handles inputs whose shortest string uses exponent notation", () => {
    expect(String(5e-7)).toBe("5e-7");
    expect(toCopyValue(5e-7, COPY_DECIMALS.marginBtc)).toBe("0.00000050");
    expect(toCopyValue(1.5e-7, COPY_DECIMALS.marginBtc)).toBe("0.00000015");
    expect(toCopyValue(1e-7, COPY_DECIMALS.marginBtc)).toBe("0.00000010");
    expect(toCopyValue(9.99e-9, COPY_DECIMALS.marginBtc)).toBe("0.00000000");
    expect(toCopyValue(5e-7, COPY_DECIMALS.positionUsd)).toBe("0");
    expect(String(1e21)).toBe("1e+21");
    expect(toCopyValue(1e21, COPY_DECIMALS.positionUsd)).toBe("1000000000000000000000");
    expect(toCopyValue(1.2345e21, COPY_DECIMALS.positionBtc)).toBe("1234500000000000000000.0000");
  });

  describe("property: copy never exceeds the source value and drops less than one step", () => {
    const DECIMALS = [COPY_DECIMALS.positionUsd, COPY_DECIMALS.positionBtc, COPY_DECIMALS.marginBtc, 2];
    // Step counts k; k * 10^-decimals stays within 15 significant digits so its decimal form is exact.
    const STEPS = [1, 7, 153, 154, 999, 1292, 1293, 53174, 53175, 99999, 1234567, 99999999, 123456789012345];

    /** Exact decimal string for the integer number of steps `k` at `decimals` places. */
    const stepString = (k: number, decimals: number): string => {
      if (decimals === 0) return String(k);
      const digits = String(k).padStart(decimals + 1, "0");
      return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
    };

    const f64 = new Float64Array(1);
    const bits = new BigInt64Array(f64.buffer);
    /** Adjacent double: `n` representable numbers away from a positive `x` (negative `n` = below). */
    const ulpShift = (x: number, n: number): number => {
      f64[0] = x;
      bits[0] += BigInt(n);
      return f64[0];
    };

    /** Deterministic LCG in [0, 1). */
    const lcg = (seed: number) => () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };

    /**
     * Invariants for every copy: strictly Number(copy) <= value (no allowance at all), and the copy
     * drops less than one step. The only slack is in the second comparison: `value * EPSILON` (>= one
     * ULP of `value`) absorbs the binary rounding of `value` and `Number(copy)`, which matters once a
     * step is smaller than the ULP (e.g. 1e-8 at 1e15).
     */
    const expectCopyInvariants = (value: number, decimals: number): void => {
      const copy = toCopyValue(value, decimals);
      const copied = Number(copy);
      expect(copy, `value ${value}`).toMatch(decimals === 0 ? /^\d+$/ : new RegExp(`^\\d+\\.\\d{${decimals}}$`));
      expect(copied <= value, `copy ${copy} exceeds value ${value}`).toBe(true);
      expect(
        value - copied < 10 ** -decimals + value * Number.EPSILON,
        `copy ${copy} drops a full step or more below ${value}`,
      ).toBe(true);
    };

    it.each(DECIMALS)("values 1-3 ULPs below a step floor to the previous step (decimals %i)", (decimals) => {
      for (const k of STEPS) {
        const stepValue = Number(stepString(k, decimals));
        // Skip combinations where 3 ULPs reach a full step (step far below the ULP).
        if (ulpShift(stepValue, 3) - stepValue >= 10 ** -decimals) continue;
        for (const n of [1, 2, 3]) {
          const value = ulpShift(stepValue, -n);
          expect(value).toBeLessThan(stepValue);
          expect(toCopyValue(value, decimals), `value ${value}`).toBe(stepString(k - 1, decimals));
          expectCopyInvariants(value, decimals);
        }
      }
    });

    it.each(DECIMALS)("exact decimal steps are kept at every magnitude (decimals %i)", (decimals) => {
      for (const k of STEPS) {
        expect(toCopyValue(Number(stepString(k, decimals)), decimals)).toBe(stepString(k, decimals));
        expect(toCopyValue(k, decimals)).toBe(decimals === 0 ? String(k) : `${k}.${"0".repeat(decimals)}`);
      }
    });

    it.each(DECIMALS)("pseudo-random values up to 1e15 and their step neighbours (decimals %i)", (decimals) => {
      const next = lcg(0x5eed + decimals);
      for (let i = 0; i < 3000; i++) {
        const magnitude = 10 ** (Math.floor(next() * 22) - 6); // 1e-6 .. 1e15
        const value = next() * magnitude;
        expectCopyInvariants(value, decimals);
        // Probe the boundary the copy landed on: the step itself and the doubles right around it.
        const landed = Number(toCopyValue(value, decimals));
        expectCopyInvariants(landed, decimals);
        expectCopyInvariants(ulpShift(landed, 1), decimals);
        if (landed > 0) {
          expectCopyInvariants(ulpShift(landed, -1), decimals);
          expectCopyInvariants(ulpShift(landed, -2), decimals);
        }
      }
    });
  });
});

describe("toPlainDecimal", () => {
  it.each([
    [84707.1, 1, "84707.1"],
    [116265, 1, "116265"],
    [116265.0, 2, "116265"],
    [84707.10000000001, 1, "84707.1"],
    [2.0000000000000003e21, 1, "2000000000000000300000"],
    [1e21, 0, "1000000000000000000000"],
    [1e-7, 8, "0.0000001"],
    [5e-7, 8, "0.0000005"],
    [1.5e-7, 8, "0.00000015"],
    [0.0154, 4, "0.0154"],
    [1e-7, 2, "0"],
    [0, 1, "0"],
  ])("%s at %i decimals -> %s", (value, decimals, expected) => {
    expect(toPlainDecimal(value, decimals)).toBe(expected);
  });

  it.each([
    [2.0000000000000003e21, 1],
    [1e21, 1],
    [1.7976931348623157e308, 1],
    [84707.1, 1],
    [116265, 1],
    [1e-7, 8],
    [5e-7, 8],
    [1.5e-7, 8],
    [5e-324, 8],
    [0.1 + 0.2, 1],
  ])("%s at %i decimals is never exponential and parseNumber accepts it", (value, decimals) => {
    const text = toPlainDecimal(value, decimals);
    expect(text).not.toMatch(/e/i);
    expect(text).not.toMatch(/\.$/);
    expect(text).not.toMatch(/\.\d*0$/);
    const parsed = parseNumber(text);
    expect(parsed).not.toBeNull();
    expect(parsed!).toBeLessThanOrEqual(value);
    expect(value - parsed!).toBeLessThan(10 ** -decimals * Math.max(1, value * 1e-15));
  });
});

describe("exactDecimal", () => {
  it.each<[number, bigint, number]>([
    // The shortest round-trip form, not the binary value: 0.3 is 3/10, not 0.299999999999999988897….
    [0.3, BigInt(3), 1],
    [65432.1, BigInt(654321), 1],
    [2453.229, BigInt(2453229), 3],
    [1292, BigInt(1292), 0],
    [0, BigInt(0), 0],
    // 0.1 + 0.2 is 0.30000000000000004 as displayed, and stays that.
    [0.1 + 0.2, BigInt("30000000000000004"), 17],
  ])("%s -> %s / 10^%i", (value, units, scale) => {
    expect(exactDecimal(value)).toEqual({ units, scale });
  });

  it.each<[number, string, bigint, number]>([
    [5e-7, "5e-7", BigInt(5), 7],
    [1.5e-7, "1.5e-7", BigInt(15), 8],
    [5e-324, "5e-324", BigInt(5), 324],
    [1e21, "1e+21", BigInt(10) ** BigInt(21), 0],
    [1.2345e21, "1.2345e+21", BigInt(12345) * BigInt(10) ** BigInt(17), 0],
    [Number.MAX_VALUE, "1.7976931348623157e+308", BigInt("17976931348623157") * BigInt(10) ** BigInt(292), 0],
  ])("parses the exponent form of %s (%s)", (value, text, units, scale) => {
    expect(String(value)).toBe(text);
    expect(exactDecimal(value)).toEqual({ units, scale });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("%s throws a RangeError", (value) => {
    expect(() => exactDecimal(value)).toThrow(RangeError);
  });
});

describe("unitsToPlainDecimal", () => {
  it.each<[bigint, number, string]>([
    [BigInt(1962963), 2, "19629.63"],
    [BigInt(3000000), 8, "0.03"],
    // Trailing zeros are dropped, with the point when nothing is left after it.
    [BigInt(1962960), 2, "19629.6"],
    [BigInt(1962900), 2, "19629"],
    [BigInt(10000), 2, "100"],
    [BigInt(30000000), 8, "0.3"],
    [BigInt(0), 8, "0"],
    // Zeros before the point and with 0 decimals are kept.
    [BigInt(100), 0, "100"],
    [BigInt(10500), 2, "105"],
    // Leading zeros are padded in below 1.
    [BigInt(1), 8, "0.00000001"],
    [BigInt(12), 8, "0.00000012"],
    [BigInt(5), 2, "0.05"],
  ])("%s at %i decimals -> %s", (units, decimals, expected) => {
    expect(unitsToPlainDecimal(units, decimals)).toBe(expected);
  });

  it("writes huge values as plain digits, never in exponent form", () => {
    expect(unitsToPlainDecimal(BigInt(10) ** BigInt(311), 8)).toBe(`1${"0".repeat(303)}`);
    expect(unitsToPlainDecimal(BigInt(10) ** BigInt(23) + BigInt(1), 2)).toBe("1000000000000000000000.01");
  });

  it("matches toPlainDecimal for the same value, so derived balances look like copy values", () => {
    for (const decimals of [0, 2, 8]) {
      for (const units of [0, 1, 5, 12, 100, 1050, 1962963, 3000000, 81774300, 123456789012]) {
        expect(unitsToPlainDecimal(BigInt(units), decimals), `${units} at ${decimals}`).toBe(
          toPlainDecimal(units / 10 ** decimals, decimals),
        );
      }
    }
  });
});

describe("de-DE display", () => {
  it("formats with comma decimal and dot grouping", () => {
    expect(formatDe(1292.24305, 2)).toBe("1.292,24");
    expect(formatDe(1.98, 2)).toBe("1,98");
    expect(formatDeCompact(2, 2)).toBe("2");
    expect(formatDeCompact(1.5, 2)).toBe("1,5");
  });
});

describe("journal TSV", () => {
  const NOW = new Date(2026, 9, 20, 9, 5, 42); // local time

  const LONG_ROW: JournalRow = {
    direction: "long",
    entry: 81005.9,
    stop: 79205.2,
    tp: 84707.1,
    riskPct: 5,
    riskBtc: 0.000362673,
    positionUsd: 1292.24305460868,
    positionBtc: 0.015952455989115363,
    leverage: 30,
    marginBtc: 0.0005317485329705121,
    liqPrice: 78697.44170984456,
    crv: 1.9219189557190406,
    compliant: false,
  };

  const HEADER = [
    "Datum/Zeit",
    "Instrument",
    "Richtung",
    "Entry",
    "Stop",
    "TP",
    "Risiko %",
    "Risiko BTC",
    "Positionswert USD",
    "Positionswert BTC",
    "Hebel",
    "Margin BTC",
    "Liquidationspreis",
    "CRV (R)",
    "Regelkonform",
  ];

  it("is a header line plus exactly one tab-separated data row", () => {
    const lines = buildJournalTsv(LONG_ROW, NOW).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].split("\t")).toEqual(HEADER);
    expect(lines[1].split("\t")).toHaveLength(HEADER.length);
  });

  it("long row: local date/time, decimal comma without grouping, copy values floored, nein", () => {
    const row = buildJournalTsv(LONG_ROW, NOW).split("\n")[1].split("\t");
    expect(row).toEqual([
      "2026-10-20 09:05",
      "BTCUSD Coin-M",
      "Long",
      "81005,9",
      "79205,2",
      "84707,1",
      "5",
      "0,00036267",
      "1292",
      "0,0159",
      "30",
      "0,00053174",
      "78697,44",
      "1,92",
      "nein",
    ]);
  });

  it("short row without TP: empty TP and CRV, ja", () => {
    const row = buildJournalTsv(
      { ...LONG_ROW, direction: "short", tp: null, crv: null, compliant: true, positionUsd: 12345.99 },
      new Date(2026, 0, 5, 7, 3),
    )
      .split("\n")[1]
      .split("\t");
    expect(row[0]).toBe("2026-01-05 07:03");
    expect(row[2]).toBe("Short");
    expect(row[5]).toBe("");
    expect(row[8]).toBe("12345");
    expect(row[13]).toBe("");
    expect(row[14]).toBe("ja");
  });

  it("copy cells never round up values genuinely below a step (QA defect 1)", () => {
    const row = buildJournalTsv(
      { ...LONG_ROW, positionUsd: 1292.999999999, positionBtc: 0.015399999999999, marginBtc: 0.00053174999999999 },
      NOW,
    )
      .split("\n")[1]
      .split("\t");
    expect(row[8]).toBe("1292");
    expect(row[9]).toBe("0,0153");
    expect(row[11]).toBe("0,00053174");
  });

  it("copy cells keep exact steps despite binary noise", () => {
    const row = buildJournalTsv({ ...LONG_ROW, positionUsd: 1292, positionBtc: 0.0154, marginBtc: 0.00015 }, NOW)
      .split("\n")[1]
      .split("\t");
    expect(row[8]).toBe("1292");
    expect(row[9]).toBe("0,0154");
    expect(row[11]).toBe("0,00015");
  });

  it("copy cells use the same truncated digits as the exchange copy, with decimal comma", () => {
    const cases: Array<[Pick<JournalRow, "positionUsd" | "positionBtc" | "marginBtc">, [string, string, string]]> = [
      // a few ULPs below a step (QA re-review A)
      [{ positionUsd: 1292.999999999999, positionBtc: 12.92999999999999, marginBtc: 1.292999999999999 }, ["1292", "12,9299", "1,29299999"]],
      // exact large values (QA re-review B/C); trailing zeros dropped
      [{ positionUsd: 2000000000000000, positionBtc: 1000000000000, marginBtc: 100000000000 }, ["2000000000000000", "1000000000000", "100000000000"]],
      [{ positionUsd: 209066750420139.53, positionBtc: 2090667504201.3953, marginBtc: 69688916806.71318 }, ["209066750420139", "2090667504201,3953", "69688916806,71318"]],
      // exponent-notation inputs
      [{ positionUsd: 1e21, positionBtc: 1.5e-7, marginBtc: 5e-7 }, ["1000000000000000000000", "0", "0,0000005"]],
    ];
    for (const [values, [usd, btc, margin]] of cases) {
      const row = buildJournalTsv({ ...LONG_ROW, ...values }, NOW).split("\n")[1].split("\t");
      expect([row[8], row[9], row[11]], JSON.stringify(values)).toEqual([usd, btc, margin]);
      expect(Number(row[8].replace(",", "."))).toBeLessThanOrEqual(values.positionUsd);
      expect(Number(row[9].replace(",", "."))).toBeLessThanOrEqual(values.positionBtc);
      expect(Number(row[11].replace(",", "."))).toBeLessThanOrEqual(values.marginBtc);
    }
  });

  it("no liquidation (Infinity) -> empty Liquidationspreis cell", () => {
    const row = buildJournalTsv({ ...LONG_ROW, liqPrice: Infinity }, NOW).split("\n")[1].split("\t");
    expect(row[12]).toBe("");
  });

  it("contains no thousands grouping dots in numeric cells", () => {
    const row = buildJournalTsv(LONG_ROW, NOW).split("\n")[1].split("\t");
    for (const cell of row.slice(3, 14)) expect(cell).not.toMatch(/\./);
  });

  it("formatLocalDateTime pads month, day, hour, minute", () => {
    expect(formatLocalDateTime(new Date(2026, 2, 4, 0, 7))).toBe("2026-03-04 00:07");
    expect(formatLocalDateTime(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31 23:59");
  });
});
