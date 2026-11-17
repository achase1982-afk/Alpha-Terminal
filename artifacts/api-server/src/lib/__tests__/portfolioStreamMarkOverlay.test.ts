import { describe, expect, it, vi } from "vitest";
import {
  overlayPortfolioMarksFromStream,
  type PortfolioMappedAccount,
} from "../portfolioStreamMarkOverlay.js";

vi.mock("../schwabStreamer.js", () => ({
  getQuoteBySymbol: (sym: string) =>
    sym === "SPY" ? { last: 500, ts: Date.now(), quoteSource: "SCHWAB" as const } : null,
  getOptionTick: (sym: string) =>
    sym === "SPY   251219C00600000" ? { mark: 2.5, ts: Date.now() } : null,
  normalizeEquityKey: (s: string) => s.toUpperCase(),
}));

describe("portfolioStreamMarkOverlay", () => {
  it("overlays real mapped position shape with signed short qty", () => {
    const mapped: PortfolioMappedAccount[] = [
      {
        balances: { liquidationValue: 10_000, longMarketValue: 0, shortMarketValue: 0 },
        initialBalances: { liquidationValue: 9_800 },
        dayPL: 200,
        totalPL: 0,
        positions: [
          {
            symbol: "SPY",
            assetType: "EQUITY",
            longQuantity: 10,
            shortQuantity: 0,
            averagePrice: 480,
            marketValue: 1,
            longOpenProfitLoss: 0,
          },
          {
            symbol: "SPY   251219C00600000",
            assetType: "OPTION",
            longQuantity: 0,
            shortQuantity: 2,
            averagePrice: 3,
            marketValue: -1,
            longOpenProfitLoss: 0,
            closePrice: 2.8,
          },
        ],
      },
    ];
    const changed = overlayPortfolioMarksFromStream(mapped);
    expect(changed).toBe(true);
    expect(mapped[0]!.positions![0]!.marketValue).toBe(5000);
    expect(mapped[0]!.positions![0]!.longOpenProfitLoss).toBe(200);
    expect(mapped[0]!.positions![1]!.marketValue).toBe(-500);
    expect(mapped[0]!.positions![1]!.longOpenProfitLoss).toBe(100);
    expect(mapped[0]!.totalPL).toBe(300);
  });
});