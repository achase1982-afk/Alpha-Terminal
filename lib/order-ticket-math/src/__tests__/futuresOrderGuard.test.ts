import { describe, expect, it } from "vitest";
import {
  isBlockedFuturesAssetType,
  isBlockedFuturesTradeSymbol,
  orderLegReferencesBlockedFutures,
  orderReferencesBlockedFutures,
} from "../futuresOrderGuard.js";

describe("futuresOrderGuard", () => {
  it("blocks slash and dotted-slash futures symbols", () => {
    expect(isBlockedFuturesTradeSymbol("/ES")).toBe(true);
    expect(isBlockedFuturesTradeSymbol("/ESZ26")).toBe(true);
    expect(isBlockedFuturesTradeSymbol("./ES")).toBe(true);
    expect(isBlockedFuturesTradeSymbol("SPY")).toBe(false);
    expect(isBlockedFuturesTradeSymbol("")).toBe(false);
  });

  it("blocks FUTURE and FUTURE_OPTION asset types", () => {
    expect(isBlockedFuturesAssetType("FUTURE")).toBe(true);
    expect(isBlockedFuturesAssetType("future_option")).toBe(true);
    expect(isBlockedFuturesAssetType("EQUITY")).toBe(false);
  });

  it("detects futures on legs and nested child orders", () => {
    expect(
      orderLegReferencesBlockedFutures({
        instrument: { symbol: "SPY", assetType: "EQUITY" },
      }),
    ).toBe(false);
    expect(
      orderLegReferencesBlockedFutures({
        instrument: { symbol: "/NQZ26", assetType: "FUTURE" },
      }),
    ).toBe(true);
    expect(
      orderLegReferencesBlockedFutures({
        instrument: { symbol: "SPX", assetType: "FUTURE_OPTION" },
      }),
    ).toBe(true);
    expect(
      orderReferencesBlockedFutures({
        orderLegCollection: [{ instrument: { symbol: "AAPL", assetType: "EQUITY" } }],
        childOrderStrategies: [
          {
            orderLegCollection: [{ instrument: { symbol: "./MES", assetType: "FUTURE" } }],
          },
        ],
      }),
    ).toBe(true);
  });
});