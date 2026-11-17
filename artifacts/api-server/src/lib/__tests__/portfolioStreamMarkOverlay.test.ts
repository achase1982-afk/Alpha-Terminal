import { describe, expect, it, vi } from "vitest";
import {
  overlayPortfolioMarksFromStream,
  type PortfolioPositionRow,
} from "../portfolioStreamMarkOverlay.js";

vi.mock("../schwabStreamer.js", () => ({
  getQuoteBySymbol: (sym: string) =>
    sym === "SPY" ? { last: 500, ts: Date.now() } : null,
  getOptionTick: (sym: string) =>
    sym === "OPT" ? { mark: 2.5, ts: Date.now() } : null,
  normalizeEquityKey: (s: string) => s.toUpperCase(),
}));

describe("portfolioStreamMarkOverlay", () => {
  it("overlays stream marks quickly", () => {
    const mapped: Array<{ positions: PortfolioPositionRow[] }> = [
      {
        positions: [
          { symbol: "SPY", assetType: "EQUITY", quantity: 10, marketValue: 1 },
          { symbol: "OPT", assetType: "OPTION", quantity: 2, marketValue: 1 },
        ],
      },
    ];
    const t0 = performance.now();
    overlayPortfolioMarksFromStream(mapped);
    expect(performance.now() - t0).toBeLessThan(5);
    expect(mapped[0]!.positions![0]!.streamMark).toBe(500);
    expect(mapped[0]!.positions![0]!.marketValue).toBe(5000);
    expect(mapped[0]!.positions![1]!.streamMark).toBe(2.5);
    expect(mapped[0]!.positions![1]!.marketValue).toBe(500);
  });
});