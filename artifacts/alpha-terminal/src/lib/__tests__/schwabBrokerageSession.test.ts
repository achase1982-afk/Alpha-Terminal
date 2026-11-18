import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  SERVER_BROKERAGE_SENTINEL,
  schwabAccessTokenForRequest,
  serverBrokerageSentinelPair,
  shouldApplyServerBrokerageSentinel,
} from "../schwabBrokerageSession";

vi.mock("@/lib/authMode", () => ({
  isAuthDisabled: vi.fn(() => false),
}));

import { isAuthDisabled } from "@/lib/authMode";

describe("schwabBrokerageSession", () => {
  beforeEach(() => {
    vi.mocked(isAuthDisabled).mockReturnValue(false);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("never exposes sentinel as a Schwab request token", () => {
    expect(schwabAccessTokenForRequest(SERVER_BROKERAGE_SENTINEL)).toBeUndefined();
    expect(schwabAccessTokenForRequest("real-token")).toBe("real-token");
  });

  it("applies sentinel only when auth disabled and server reports connected", () => {
    vi.mocked(isAuthDisabled).mockReturnValue(true);
    expect(
      shouldApplyServerBrokerageSentinel({
        market: { connected: true },
        trader: null,
      }),
    ).toBe(true);
    expect(shouldApplyServerBrokerageSentinel({ market: null, trader: null })).toBe(false);

    vi.mocked(isAuthDisabled).mockReturnValue(false);
    expect(
      shouldApplyServerBrokerageSentinel({
        market: { connected: true },
      }),
    ).toBe(false);
  });

  it("serverBrokerageSentinelPair uses non-secret placeholder", () => {
    const pair = serverBrokerageSentinelPair();
    expect(pair.access).toBe(SERVER_BROKERAGE_SENTINEL);
    expect(pair.refresh).toBe("");
  });
});