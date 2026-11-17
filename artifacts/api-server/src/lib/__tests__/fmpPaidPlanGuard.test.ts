import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emptyFmpResponse,
  fetchFmp,
  fmpEndpointPaused,
  isFmpPaidDenial,
  resetFmpPaidPlanGuardForTests,
} from "../fmpPaidPlanGuard.js";

const url = "https://financialmodelingprep.com/stable/earnings-calendar?apikey=secret&from=2026-01-01";

afterEach(() => {
  resetFmpPaidPlanGuardForTests();
  vi.unstubAllGlobals();
});

describe("isFmpPaidDenial", () => {
  it("matches plan statuses and the known body phrases", () => {
    expect(isFmpPaidDenial(402, "")).toBe(true);
    expect(isFmpPaidDenial(403, "")).toBe(true);
    expect(isFmpPaidDenial(401, "")).toBe(true);
    expect(isFmpPaidDenial(200, "Exclusive Endpoint : upgrade your plan")).toBe(true);
    expect(isFmpPaidDenial(200, "Legacy Endpoint")).toBe(true);
    expect(isFmpPaidDenial(200, "this is a premium dataset")).toBe(true);
    expect(isFmpPaidDenial(200, "[]")).toBe(false);
    expect(isFmpPaidDenial(429, "too many requests")).toBe(false);
  });
});

describe("fetchFmp", () => {
  it("returns an empty list and does not call FMP again for 6 hours", async () => {
    const fetchMock = vi.fn(async () => new Response("Exclusive Endpoint", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchFmp(url);
    expect(await first.json()).toEqual([]);
    expect(first.status).toBe(200);
    expect(fmpEndpointPaused(url)).toBe(true);

    const second = await fetchFmp(url);
    expect(await second.json()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes a normal payload through", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[{\"symbol\":\"AAPL\"}]", { status: 200 })));
    const res = await fetchFmp(url);
    expect(await res.json()).toEqual([{ symbol: "AAPL" }]);
    expect(fmpEndpointPaused(url)).toBe(false);
  });

  it("empty helper is a JSON array", async () => {
    expect(await emptyFmpResponse().json()).toEqual([]);
  });
});
