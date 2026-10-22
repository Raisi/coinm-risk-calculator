// Lets pending promise callbacks run; only timeouts and intervals are faked below.
import { setImmediate as flush } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchLivePrice,
  LIVE_PRICE_SOURCE,
  LIVE_PRICE_TIMEOUT_MS,
  LIVE_PRICE_URL,
  LivePriceError,
  livePriceEntry,
  livePriceHint,
  parseLivePrice,
} from "./livePrice";

/** Response body as Binance sent it (curl, 2026-10-22). */
const SAMPLE_BODY = [{ price: "81657.3", ps: "BTCUSD", symbol: "BTCUSD_PERP", time: 1792661988378 }];

const sampleWith = (patch: Record<string, unknown>) => [{ ...SAMPLE_BODY[0], ...patch }];

const sampleWithout = (key: string) => [
  Object.fromEntries(Object.entries(SAMPLE_BODY[0]).filter(([k]) => k !== key)),
];

describe("parseLivePrice", () => {
  it("accepts the real Binance sample body", () => {
    expect(parseLivePrice(SAMPLE_BODY)).toStrictEqual({ price: 81657.3, time: 1792661988378 });
  });

  it("accepts the sample after a JSON round trip", () => {
    expect(parseLivePrice(JSON.parse(JSON.stringify(SAMPLE_BODY)))).toStrictEqual({
      price: 81657.3,
      time: 1792661988378,
    });
  });

  it("picks the BTCUSD_PERP element when other symbols come first", () => {
    const body = [{ price: "1.5", symbol: "ETHUSD_PERP", time: 1 }, ...SAMPLE_BODY];
    expect(parseLivePrice(body)).toStrictEqual({ price: 81657.3, time: 1792661988378 });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", JSON.stringify(SAMPLE_BODY)],
    ["a number", 81657.3],
    ["an empty object", {}],
    ["the ticker object without array", SAMPLE_BODY[0]],
    ["an array-like object", { 0: SAMPLE_BODY[0], length: 1 }],
    ["an empty array", []],
    ["an array of null", [null]],
    ["an array of primitives", [81657.3, "81657.3", "BTCUSD_PERP"]],
    ["an array of arrays", [SAMPLE_BODY]],
  ])("rejects %s", (_label, body) => {
    expect(parseLivePrice(body)).toBeNull();
  });

  it.each([
    ["a quarterly contract", "BTCUSD_261225"],
    ["another perpetual", "ETHUSD_PERP"],
    ["a USDⓈ-M symbol", "BTCUSDT"],
    ["a lowercase symbol", "btcusd_perp"],
    ["a padded symbol", " BTCUSD_PERP"],
    ["an empty symbol", ""],
    ["a null symbol", null],
    ["the pair instead of the symbol", "BTCUSD"],
  ])("rejects %s", (_label, symbol) => {
    expect(parseLivePrice(sampleWith({ symbol }))).toBeNull();
  });

  it("rejects a ticker without symbol", () => {
    expect(parseLivePrice(sampleWithout("symbol"))).toBeNull();
  });

  it("rejects a ticker without price", () => {
    expect(parseLivePrice(sampleWithout("price"))).toBeNull();
  });

  it.each([
    ["a number", 81657.3],
    ["null", null],
    ["a boolean", true],
    ["an array", ["81657.3"]],
    ["an object", { value: "81657.3" }],
  ])("rejects a price that is %s instead of a string", (_label, price) => {
    expect(parseLivePrice(sampleWith({ price }))).toBeNull();
  });

  it.each([
    ["zero", "0"],
    ["zero with decimals", "0.0"],
    ["zero with many decimals", "0.00000000"],
    ["negative", "-81657.3"],
    ["negative zero", "-0"],
    ["non-numeric", "abc"],
    ["empty", ""],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["partly numeric", "81657.3abc"],
    ["exponent", "8.16573e4"],
    ["uppercase exponent", "1E5"],
    ["leading whitespace", " 81657.3"],
    ["trailing whitespace", "81657.3 "],
    ["trailing newline", "81657.3\n"],
    ["explicit plus sign", "+81657.3"],
    ["hexadecimal", "0x13F09"],
    ["comma grouping", "81,657.3"],
    ["decimal comma", "81657,3"],
    ["numeric separator", "81_657.3"],
    ["overflow to Infinity", `1${"0".repeat(400)}`],
    ["overflow with decimals", `${"9".repeat(320)}.5`],
  ])("rejects a %s price", (_label, price) => {
    expect(parseLivePrice(sampleWith({ price }))).toBeNull();
  });

  it.each([
    ["integer", "81657", 81657],
    ["two decimals", "81657.35", 81657.35],
    ["trailing zero", "81657.30", 81657.3],
    ["small positive", "0.1", 0.1],
  ])("accepts a plain dot-decimal %s price", (_label, price, expected) => {
    expect(parseLivePrice(sampleWith({ price }))).toStrictEqual({ price: expected, time: 1792661988378 });
  });

  describe("time", () => {
    it("keeps a valid exchange time", () => {
      expect(parseLivePrice(sampleWith({ time: 1 }))?.time).toBe(1);
      expect(parseLivePrice(sampleWith({ time: 8.64e15 }))?.time).toBe(8.64e15);
    });

    it("is null without time but the price is still accepted", () => {
      expect(parseLivePrice(sampleWithout("time"))).toStrictEqual({ price: 81657.3, time: null });
    });

    it.each([
      ["null", null],
      ["a numeric string", "1792661988378"],
      ["an ISO string", "2026-10-22T10:42:05Z"],
      ["zero", 0],
      ["negative", -1792661988378],
      ["fractional", 1792661988378.5],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["beyond the Date range", 8.64e15 + 1],
      ["an object", { ms: 1792661988378 }],
    ])("is null for %s and the price is still accepted", (_label, time) => {
      expect(parseLivePrice(sampleWith({ time }))).toStrictEqual({ price: 81657.3, time: null });
    });
  });
});

describe("livePriceEntry", () => {
  it.each([
    [81657.3, "81657.3"],
    [81657, "81657"],
    [116265.0, "116265"],
    [81657.30000000001, "81657.3"],
    [0.1 + 0.2, "0.3"],
    [1e21, "1000000000000000000000"],
  ])("%s -> %s", (price, expected) => {
    expect(livePriceEntry(price)).toBe(expected);
  });

  it.each([
    [81657.39, "81657.3"],
    [81657.35, "81657.3"],
    [81657.2999, "81657.2"],
    [81657.0999, "81657"],
    [81657.99, "81657.9"],
    [81657.999999, "81657.9"],
  ])("rounds %s down to the 0.1 tick -> %s", (price, expected) => {
    expect(livePriceEntry(price)).toBe(expected);
  });

  it.each([81657.3, 81657.39, 81657, 0.3, 1e21, 123456789.987])(
    "%s is a plain dot decimal with at most one decimal",
    (price) => {
      expect(livePriceEntry(price)).toMatch(/^\d+(\.\d)?$/);
    },
  );

  it("turns the sample response into the Entry text", () => {
    const quote = parseLivePrice(SAMPLE_BODY);
    expect(quote).not.toBeNull();
    expect(livePriceEntry(quote!.price)).toBe("81657.3");
  });
});

describe("livePriceHint", () => {
  // Built from local-time components, so the expected clock text holds in every time zone.
  const exchangeTime = new Date(2026, 9, 22, 10, 42, 5).getTime();
  const now = new Date(2026, 9, 22, 23, 59, 58);

  it("names the source and the exchange time", () => {
    expect(livePriceHint({ price: 81657.3, time: exchangeTime }, now)).toBe(
      "Binance Coin-M BTCUSD_PERP · 10:42:05",
    );
  });

  it("uses `now` when the response had no time", () => {
    expect(livePriceHint({ price: 81657.3, time: null }, now)).toBe(`${LIVE_PRICE_SOURCE} · 23:59:58`);
  });

  it("zero-pads hours, minutes and seconds", () => {
    const time = new Date(2026, 0, 5, 7, 3, 9).getTime();
    expect(livePriceHint({ price: 1, time }, now)).toBe(`${LIVE_PRICE_SOURCE} · 07:03:09`);
    expect(livePriceHint({ price: 1, time: null }, new Date(2026, 0, 5, 0, 0, 0))).toBe(
      `${LIVE_PRICE_SOURCE} · 00:00:00`,
    );
  });

  it("names Binance and the contract", () => {
    expect(LIVE_PRICE_SOURCE).toContain("Binance");
    expect(LIVE_PRICE_SOURCE).toContain("BTCUSD_PERP");
  });
});

interface FetchCall {
  /** Request as a browser would build it from the fetch arguments. */
  request: Request;
  /** Signal handed to fetch, if any. */
  signal: AbortSignal | undefined;
}

/** Injectable fetch that records every call; `respond` decides the outcome per call. */
function fakeFetch(respond: (call: FetchCall) => Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const request = new Request(input, init);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined) ?? undefined;
    const call = { request, signal };
    calls.push(call);
    return respond(call);
  };
  return { fetch: fetchImpl, calls };
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A minimal response whose body read is under test control. */
const responseWithJson = (json: () => Promise<unknown>) =>
  ({ ok: true, status: 200, json }) as unknown as Response;

/** Observes a promise without leaving its rejection unhandled. */
function track<T>(promise: Promise<T>) {
  const state: { status: "pending" | "fulfilled" | "rejected"; value?: T; reason?: unknown } = {
    status: "pending",
  };
  promise.then(
    (value) => Object.assign(state, { status: "fulfilled", value }),
    (reason: unknown) => Object.assign(state, { status: "rejected", reason }),
  );
  return state;
}

const useFakeTimeouts = () =>
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });

describe("fetchLivePrice", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("targets the verified Binance Coin-M endpoint", () => {
    expect(LIVE_PRICE_URL).toBe("https://dapi.binance.com/dapi/v1/ticker/price?symbol=BTCUSD_PERP");
  });

  it("resolves with the validated price", async () => {
    const { fetch } = fakeFetch(async () => jsonResponse(SAMPLE_BODY));
    await expect(fetchLivePrice({ fetch })).resolves.toStrictEqual({ price: 81657.3, time: 1792661988378 });
  });

  it("sends exactly one GET without cookies or cache", async () => {
    const { fetch, calls } = fakeFetch(async () => jsonResponse(SAMPLE_BODY));
    await fetchLivePrice({ fetch });
    expect(calls).toHaveLength(1);
    const { request } = calls[0];
    expect(request.url).toBe(LIVE_PRICE_URL);
    expect(request.method).toBe("GET");
    expect(request.credentials).toBe("omit");
    expect(request.cache).toBe("no-store");
    expect(request.body).toBeNull();
    for (const header of ["authorization", "cookie", "x-mbx-apikey"]) {
      expect(request.headers.has(header)).toBe(false);
    }
  });

  it("sends one request per call and never reuses a previous result", async () => {
    const prices = ["81657.3", "81700.1"];
    const { fetch, calls } = fakeFetch(async () => jsonResponse(sampleWith({ price: prices[calls.length - 1] })));
    await expect(fetchLivePrice({ fetch })).resolves.toMatchObject({ price: 81657.3 });
    expect(calls).toHaveLength(1);
    await expect(fetchLivePrice({ fetch })).resolves.toMatchObject({ price: 81700.1 });
    expect(calls).toHaveLength(2);
  });

  it("uses the global fetch when none is injected", async () => {
    const { fetch, calls } = fakeFetch(async () => jsonResponse(SAMPLE_BODY));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchLivePrice()).resolves.toStrictEqual({ price: 81657.3, time: 1792661988378 });
    expect(calls).toHaveLength(1);
    expect(calls[0].request.credentials).toBe("omit");
  });

  it.each([400, 403, 404, 418, 429, 451, 500, 502, 503])(
    "rejects HTTP %i with LivePriceError and no retry, even with a valid body",
    async (status) => {
      const { fetch, calls } = fakeFetch(async () => jsonResponse(SAMPLE_BODY, status));
      await expect(fetchLivePrice({ fetch })).rejects.toBeInstanceOf(LivePriceError);
      expect(calls).toHaveLength(1);
    },
  );

  it.each([
    ["HTML", "<html><body>Access denied</body></html>"],
    ["empty", ""],
    ["truncated JSON", JSON.stringify(SAMPLE_BODY).slice(0, 20)],
  ])("rejects a %s body with LivePriceError", async (_label, text) => {
    const { fetch, calls } = fakeFetch(async () => new Response(text, { status: 200 }));
    await expect(fetchLivePrice({ fetch })).rejects.toBeInstanceOf(LivePriceError);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["wrong symbol", sampleWith({ symbol: "ETHUSD_PERP" })],
    ["zero price", sampleWith({ price: "0" })],
    ["negative price", sampleWith({ price: "-81657.3" })],
    ["numeric price", sampleWith({ price: 81657.3 })],
    ["empty array", []],
    ["object", SAMPLE_BODY[0]],
    ["error payload", { code: -1121, msg: "Invalid symbol." }],
    ["null", null],
  ])("rejects a JSON body with %s as LivePriceError", async (_label, body) => {
    const { fetch } = fakeFetch(async () => jsonResponse(body));
    await expect(fetchLivePrice({ fetch })).rejects.toBeInstanceOf(LivePriceError);
  });

  it("LivePriceError is an Error with its own name", async () => {
    const { fetch } = fakeFetch(async () => jsonResponse(SAMPLE_BODY, 503));
    const error = await fetchLivePrice({ fetch }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("LivePriceError");
  });

  it("rejects with the fetch failure and does not retry", async () => {
    const failure = new TypeError("Failed to fetch");
    const { fetch, calls } = fakeFetch(() => Promise.reject(failure));
    await expect(fetchLivePrice({ fetch })).rejects.toBe(failure);
    expect(calls).toHaveLength(1);
  });

  describe("caller abort", () => {
    it("before the call sends no request and rejects with the reason", async () => {
      const controller = new AbortController();
      const reason = new Error("input changed");
      controller.abort(reason);
      const { fetch, calls } = fakeFetch(async () => jsonResponse(SAMPLE_BODY));
      await expect(fetchLivePrice({ fetch, signal: controller.signal })).rejects.toBe(reason);
      expect(calls).toHaveLength(0);
    });

    it("before the call rejects with an AbortError by default", async () => {
      const { fetch, calls } = fakeFetch(async () => jsonResponse(SAMPLE_BODY));
      const error = await fetchLivePrice({ fetch, signal: AbortSignal.abort() }).catch((e: unknown) => e);
      expect((error as Error).name).toBe("AbortError");
      expect(calls).toHaveLength(0);
    });

    it("during the request rejects at once even if fetch ignores the signal, and a late response is dropped", async () => {
      const controller = new AbortController();
      const reason = new Error("input changed");
      const response = Promise.withResolvers<Response>();
      const { fetch, calls } = fakeFetch(() => response.promise);
      const result = track(fetchLivePrice({ fetch, signal: controller.signal }));
      await flush();
      expect(calls).toHaveLength(1);
      expect(result.status).toBe("pending");

      controller.abort(reason);
      await flush();
      expect(result).toMatchObject({ status: "rejected", reason });

      response.resolve(jsonResponse(SAMPLE_BODY));
      await flush();
      expect(result).toMatchObject({ status: "rejected", reason });
      expect(calls).toHaveLength(1);
    });

    it("during the request aborts the signal handed to fetch", async () => {
      const controller = new AbortController();
      const { fetch, calls } = fakeFetch(
        ({ signal }) => {
          const { promise, reject } = Promise.withResolvers<Response>();
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          return promise;
        },
      );
      const reason = new Error("unmounted");
      const result = fetchLivePrice({ fetch, signal: controller.signal });
      await flush();
      expect(calls[0].signal?.aborted).toBe(false);
      controller.abort(reason);
      await expect(result).rejects.toBe(reason);
      expect(calls[0].signal?.aborted).toBe(true);
    });

    it("while the body is read rejects and drops the late body", async () => {
      const controller = new AbortController();
      const reason = new Error("input changed");
      const body = Promise.withResolvers<unknown>();
      const { fetch } = fakeFetch(async () => responseWithJson(() => body.promise));
      const result = track(fetchLivePrice({ fetch, signal: controller.signal }));
      await flush();
      expect(result.status).toBe("pending");

      controller.abort(reason);
      await flush();
      expect(result).toMatchObject({ status: "rejected", reason });

      body.resolve(SAMPLE_BODY);
      await flush();
      expect(result).toMatchObject({ status: "rejected", reason });
    });

    it.each([
      ["a valid answer", 200],
      ["an HTTP error", 503],
    ])("right after %s that arrived instantly rejects with the abort reason", async (_label, status) => {
      const controller = new AbortController();
      const reason = new Error("input changed");
      const { fetch } = fakeFetch(() => Promise.resolve(jsonResponse(SAMPLE_BODY, status)));
      const result = fetchLivePrice({ fetch, signal: controller.signal });
      controller.abort(reason);
      await expect(result).rejects.toBe(reason);
    });

    it("after the result has settled no longer reaches the finished request", async () => {
      const controller = new AbortController();
      const { fetch, calls } = fakeFetch(async () => jsonResponse(SAMPLE_BODY));
      await fetchLivePrice({ fetch, signal: controller.signal });
      controller.abort();
      expect(calls[0].signal?.aborted).toBe(false);
    });
  });

  describe("timeout", () => {
    it("defaults to about 8 seconds", () => {
      expect(LIVE_PRICE_TIMEOUT_MS).toBeGreaterThanOrEqual(5000);
      expect(LIVE_PRICE_TIMEOUT_MS).toBeLessThanOrEqual(10000);
    });

    it("rejects a hanging request with TimeoutError after the default timeout and does not retry", async () => {
      useFakeTimeouts();
      const response = Promise.withResolvers<Response>();
      const { fetch, calls } = fakeFetch(() => response.promise);
      const result = track(fetchLivePrice({ fetch }));

      await vi.advanceTimersByTimeAsync(LIVE_PRICE_TIMEOUT_MS - 1);
      expect(result.status).toBe("pending");

      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect(result.status).toBe("rejected");
      expect(result.reason).toBeInstanceOf(DOMException);
      expect((result.reason as DOMException).name).toBe("TimeoutError");
      expect(calls).toHaveLength(1);
      expect(calls[0].signal?.aborted).toBe(true);

      response.resolve(jsonResponse(SAMPLE_BODY));
      await flush();
      expect(result.status).toBe("rejected");
      expect(calls).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("honours a custom timeout", async () => {
      useFakeTimeouts();
      const { fetch } = fakeFetch(() => Promise.withResolvers<Response>().promise);
      const result = track(fetchLivePrice({ fetch, timeoutMs: 100 }));
      await vi.advanceTimersByTimeAsync(99);
      expect(result.status).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect((result.reason as DOMException | undefined)?.name).toBe("TimeoutError");
    });

    it("also covers a body read that hangs", async () => {
      useFakeTimeouts();
      const { fetch } = fakeFetch(async () => responseWithJson(() => Promise.withResolvers().promise));
      const result = track(fetchLivePrice({ fetch }));
      await vi.advanceTimersByTimeAsync(LIVE_PRICE_TIMEOUT_MS);
      await flush();
      expect(result.status).toBe("rejected");
      expect((result.reason as DOMException).name).toBe("TimeoutError");
    });

    it("does not fire for a request that answers in time", async () => {
      useFakeTimeouts();
      const response = Promise.withResolvers<Response>();
      const { fetch, calls } = fakeFetch(() => response.promise);
      const result = track(fetchLivePrice({ fetch }));
      await vi.advanceTimersByTimeAsync(LIVE_PRICE_TIMEOUT_MS - 1);
      response.resolve(responseWithJson(async () => SAMPLE_BODY));
      await flush();
      expect(result).toMatchObject({ status: "fulfilled", value: { price: 81657.3 } });
      await vi.advanceTimersByTimeAsync(LIVE_PRICE_TIMEOUT_MS);
      expect(calls[0].signal?.aborted).toBe(false);
    });
  });

  describe("leaves no timer behind", () => {
    const pendingForever = () => Promise.withResolvers<Response>().promise;

    it.each([
      ["success", () => Promise.resolve(responseWithJson(async () => SAMPLE_BODY))],
      ["HTTP error", () => Promise.resolve({ ok: false, status: 503 } as Response)],
      ["invalid JSON", () => Promise.resolve(responseWithJson(() => Promise.reject(new SyntaxError("bad"))))],
      ["invalid body", () => Promise.resolve(responseWithJson(async () => []))],
      ["fetch failure", () => Promise.reject(new TypeError("Failed to fetch"))],
    ])("after %s", async (_label, respond) => {
      useFakeTimeouts();
      const { fetch } = fakeFetch(respond);
      const result = track(fetchLivePrice({ fetch }));
      await flush();
      expect(result.status).not.toBe("pending");
      expect(vi.getTimerCount()).toBe(0);
    });

    it("after a caller abort", async () => {
      useFakeTimeouts();
      const controller = new AbortController();
      const { fetch } = fakeFetch(pendingForever);
      const result = track(fetchLivePrice({ fetch, signal: controller.signal }));
      await flush();
      expect(vi.getTimerCount()).toBe(1);
      controller.abort();
      await flush();
      expect(result.status).toBe("rejected");
      expect(vi.getTimerCount()).toBe(0);
    });

    it("after an abort before the call", async () => {
      useFakeTimeouts();
      const { fetch } = fakeFetch(pendingForever);
      const result = track(fetchLivePrice({ fetch, signal: AbortSignal.abort() }));
      await flush();
      expect(result.status).toBe("rejected");
      expect(vi.getTimerCount()).toBe(0);
    });

    it("after a timeout", async () => {
      useFakeTimeouts();
      const { fetch } = fakeFetch(pendingForever);
      const result = track(fetchLivePrice({ fetch }));
      await vi.advanceTimersByTimeAsync(LIVE_PRICE_TIMEOUT_MS);
      await flush();
      expect(result.status).toBe("rejected");
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
