import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../schwabStreamer.js", () => ({
  getQuoteBySymbol: vi.fn(),
  normalizeEquityKey: (s: string) => (s.toUpperCase() === "SPX" ? "$SPX" : s),
}));

vi.mock("../deskSchwabQuotes.js", () => ({
  deskFetchSchwabQuotes: vi.fn(),
}));

import { getQuoteBySymbol } from "../../schwabStreamer.js";
import { deskFetchSchwabQuotes } from "../deskSchwabQuotes.js";
import { deskResolveSpxSpot } from "../deskSpxSpot.js";

describe("deskResolveSpxSpot", () => {
  beforeEach(() => {
    vi.mocked(getQuoteBySymbol).mockReset();
    vi.mocked(deskFetchSchwabQuotes).mockReset();
  });

  it("uses streamer last price", async () => {
    vi.mocked(getQuoteBySymbol).mockReturnValue({
      symbol: "$SPX",
      last: 6000.5,
      regularLast: null,
    } as never);
    await expect(deskResolveSpxSpot()).resolves.toBe(6000.5);
    expect(deskFetchSchwabQuotes).not.toHaveBeenCalled();
  });

  it("falls back to Schwab REST", async () => {
    vi.mocked(getQuoteBySymbol).mockReturnValue(undefined);
    vi.mocked(deskFetchSchwabQuotes).mockResolvedValue({
      quotes: [
        {
          symbol: "$SPX",
          last: 5999,
          bid: null,
          ask: null,
          change: null,
          change_pct: null,
          quote_ts: null,
          trade_ts: null,
          bid_size: null,
          ask_size: null,
          volume: null,
        },
      ],
      asOfMs: Date.now(),
      session_date: "2026-11-17",
    });
    await expect(deskResolveSpxSpot()).resolves.toBe(5999);
  });
});