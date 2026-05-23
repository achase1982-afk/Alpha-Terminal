import { describe, expect, it } from "vitest";
import type { FmpMoverRow } from "../fmpMoversClient.js";
import type { FmpCompanyProfile } from "../fmpCompanyProfile.js";
import { isBelowMarketCapFloor, stripMicroCap } from "../stripMicroCap.js";
import { MARKET_CAP_FLOOR } from "../moversConfig.js";

function row(symbol: string, mcap: number): { row: FmpMoverRow; profile: FmpCompanyProfile } {
  const fmpRow: FmpMoverRow = {
    symbol,
    name: `${symbol} Inc.`,
    exchange: "NASDAQ",
    price: 20,
    change: 1,
    changesPercentage: 10,
  };
  const profile: FmpCompanyProfile = {
    symbol,
    marketCap: mcap,
    sector: "Technology",
    industry: "Software",
    description: null,
    averageVolume: 1_000_000,
  };
  return { row: fmpRow, profile };
}

describe("stripMicroCap", () => {
  it("treats missing or sub-floor market cap as MICRO_CAP", () => {
    expect(isBelowMarketCapFloor(null)).toBe(true);
    expect(isBelowMarketCapFloor(MARKET_CAP_FLOOR - 1)).toBe(true);
    expect(isBelowMarketCapFloor(MARKET_CAP_FLOOR)).toBe(false);
    expect(isBelowMarketCapFloor(MARKET_CAP_FLOOR + 1)).toBe(false);
  });

  it("moves sub-$500M names to filtered with MICRO_CAP reason", () => {
    const a = row("AKTX", 20_000_000);
    const b = row("NVTS", 6_000_000_000);
    const profiles = new Map<string, FmpCompanyProfile>([
      [a.row.symbol, a.profile],
      [b.row.symbol, b.profile],
    ]);

    const { tradeable, filtered } = stripMicroCap([a.row, b.row], profiles);
    expect(tradeable.map((r) => r.symbol)).toEqual(["NVTS"]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.symbol).toBe("AKTX");
    expect(filtered[0]?.reason).toBe("MICRO_CAP");
  });
});
