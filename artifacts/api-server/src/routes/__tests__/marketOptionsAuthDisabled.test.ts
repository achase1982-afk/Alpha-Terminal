import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const tokenMocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(() => "server-market-token"),
  getBestAccessToken: vi.fn(() => "server-market-token"),
}));

vi.mock("../../lib/tokenStore.js", () => ({
  getAccessToken: tokenMocks.getAccessToken,
  getBestAccessToken: tokenMocks.getBestAccessToken,
}));

vi.mock("../../lib/telemetry.js", () => ({
  logFailure: vi.fn(),
  emitTelemetry: vi.fn(),
}));

vi.mock("../../lib/schwabStreamer.js", () => ({
  getQuoteBySymbol: () => ({ last: 500, close: 499 }),
  addSymbols: vi.fn(),
}));

function emptyChainJson() {
  return {
    callExpDateMap: {
      "2026-12-19:30": {
        "500.0": [
          {
            putCall: "CALL",
            symbol: "SPY  261219C00500000",
            strikePrice: 500,
            bid: 1,
            ask: 1.1,
            last: 1.05,
            totalVolume: 10,
            openInterest: 100,
            delta: 0.5,
          },
        ],
      },
    },
    putExpDateMap: {
      "2026-12-19:30": {
        "500.0": [
          {
            putCall: "PUT",
            symbol: "SPY  261219P00500000",
            strikePrice: 500,
            bid: 1,
            ask: 1.1,
            last: 1.05,
            totalVolume: 10,
            openInterest: 100,
            delta: -0.5,
          },
        ],
      },
    },
    underlyingPrice: 500,
  };
}

import marketRouter from "../market.js";

describe("GET /market/options with AUTH_DISABLED", () => {
  const prev = process.env.AUTH_DISABLED;

  beforeEach(() => {
    process.env.AUTH_DISABLED = "true";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => emptyChainJson(),
        text: async () => "",
        headers: new Headers(),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (prev === undefined) delete process.env.AUTH_DISABLED;
    else process.env.AUTH_DISABLED = prev;
  });

  it("loads options using server token without client accessToken query", async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
      next();
    });
    app.use("/market", marketRouter);

    const res = await request(app).get("/market/options?symbol=SPY&strikeCount=5");
    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe("SPY");
    expect(res.body.error).not.toBe("symbol and accessToken are required");
    expect(tokenMocks.getBestAccessToken).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalled();
    const fetchUrl = String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? "");
    expect(fetchUrl).toContain("schwabapi");
  });
});