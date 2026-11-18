import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Request } from "express";

const mocks = vi.hoisted(() => ({
  getBest: vi.fn(),
  getMarket: vi.fn(),
  getTrader: vi.fn(),
}));

vi.mock("../tokenStore.js", () => ({
  getBestAccessToken: mocks.getBest,
  getAccessToken: (kind: "market" | "trader") =>
    kind === "market" ? mocks.getMarket() : mocks.getTrader(),
}));

import { schwabAccessTokenFromRequest } from "../schwabRouteAccessToken.js";

describe("schwabAccessTokenFromRequest", () => {
  const prev = process.env.AUTH_DISABLED;

  afterEach(() => {
    if (prev === undefined) delete process.env.AUTH_DISABLED;
    else process.env.AUTH_DISABLED = prev;
  });

  it("uses server token when auth disabled even if query token present", () => {
    process.env.AUTH_DISABLED = "true";
    mocks.getBest.mockReturnValue("server-side-token");
    mocks.getMarket.mockReturnValue(null);
    mocks.getTrader.mockReturnValue(null);

    const req = { query: { accessToken: "client-supplied-token" } } as unknown as Request;
    expect(schwabAccessTokenFromRequest(req)).toBe("server-side-token");
  });

  it("uses query token when auth enabled", () => {
    delete process.env.AUTH_DISABLED;
    mocks.getMarket.mockReturnValue("market-fallback");
    const req = { query: { accessToken: "from-browser" } } as unknown as Request;
    expect(schwabAccessTokenFromRequest(req)).toBe("from-browser");
  });
});