import { describe, expect, it, vi, beforeEach } from "vitest";
import type { FmpMoverRow } from "../fmpMoversClient.js";
import type { FmpCompanyProfile } from "../fmpCompanyProfile.js";
import { buildMoversFeedFromRows } from "../buildMoversFeed.js";
import * as fmpCompanyProfile from "../fmpCompanyProfile.js";
import * as moversDeterministicCatalyst from "../moversDeterministicCatalyst.js";

vi.mock("../fmpCompanyProfile.js", () => ({
  fetchFmpCompanyProfiles: vi.fn(),
}));

vi.mock("../moversDeterministicCatalyst.js", () => ({
  applyDeterministicCatalystToSituations: vi.fn(async (situations: unknown[]) => ({
    situations,
    flagged: [],
  })),
}));

const fetchProfiles = vi.mocked(fmpCompanyProfile.fetchFmpCompanyProfiles);

function mover(symbol: string, price: number, name: string): FmpMoverRow {
  return {
    symbol,
    name,
    exchange: "NASDAQ",
    price,
    change: 1,
    changesPercentage: 50,
  };
}

beforeEach(() => {
  fetchProfiles.mockReset();
});

describe("buildMoversFeedFromRows enrichment", () => {
  it("drops micro-caps after profile enrichment and attaches sector/industry on survivors", async () => {
    const rows = [
      mover("AKTX", 18, "Akari Therapeutics"),
      mover("NVTS", 29, "Navitas Semiconductor"),
    ];

    const profiles = new Map<string, FmpCompanyProfile>([
      [
        "AKTX",
        {
          symbol: "AKTX",
          marketCap: 20_000_000,
          sector: "Healthcare",
          industry: "Biotechnology",
          description: null,
          averageVolume: 500_000,
        },
      ],
      [
        "NVTS",
        {
          symbol: "NVTS",
          marketCap: 6_800_000_000,
          sector: "Technology",
          industry: "Semiconductors",
          description: "Power semiconductors.",
          averageVolume: 5_000_000,
        },
      ],
    ]);
    fetchProfiles.mockResolvedValue(profiles);

    const feed = await buildMoversFeedFromRows(rows);

    expect(feed.funnel.detected).toBe(2);
    expect(feed.funnel.filtered).toBe(1);
    expect(feed.funnel.tradeable).toBe(1);
    expect(feed.filtered[0]?.reason).toBe("MICRO_CAP");
    expect(feed.situations).toHaveLength(1);
    expect(feed.funnel.situations).toBe(1);
    const t = feed.situations[0]?.tickers[0];
    expect(t?.symbol).toBe("NVTS");
    expect(feed.situations[0]?.kind).toBe("single");
    expect(t?.sector).toBe("Technology");
    expect(t?.industry).toBe("Semiconductors");
    expect(t?.marketCap).toBe(6_800_000_000);
  });
});
