import { describe, expect, it } from "vitest";
import type { FmpMoverRow } from "../fmpMoversClient.js";
import type { FmpCompanyProfile } from "../fmpCompanyProfile.js";
import { clusterEnrichedMovers } from "../clusterMovers.js";

function enriched(
  symbol: string,
  name: string,
  industry: string,
  pct: number,
): { row: FmpMoverRow; profile: FmpCompanyProfile } {
  return {
    row: {
      symbol,
      name,
      exchange: "NASDAQ",
      price: 25,
      change: 2,
      changesPercentage: pct,
    },
    profile: {
      symbol,
      marketCap: 2_000_000_000,
      sector: "Technology",
      industry,
      averageVolume: 1_000_000,
    },
  };
}

describe("clusterEnrichedMovers", () => {
  it("collapses theme-matched names into one cluster situation", () => {
    const items = [
      enriched("RGTI", "Rigetti Computing, Inc.", "Quantum Computing", 40),
      enriched("IONQ", "IonQ, Inc.", "Quantum Computing", 25),
      enriched("NVTS", "Navitas Semiconductor", "Semiconductors", 30),
    ];

    const situations = clusterEnrichedMovers(items);
    const quantum = situations.find((s) => s.kind === "cluster" && s.label === "Quantum Computing");
    const singles = situations.filter((s) => s.kind === "single");

    expect(quantum).toBeDefined();
    expect(quantum?.tickers).toHaveLength(2);
    expect(singles).toHaveLength(1);
    expect(singles[0]?.tickers[0]?.symbol).toBe("NVTS");
    expect(situations.length).toBeLessThan(items.length);
  });

  it("groups by industry when no theme keyword matches", () => {
    const items = [
      enriched("AAA", "Alpha Motors", "Auto Manufacturers", 10),
      enriched("BBB", "Beta Motors", "Auto Manufacturers", 8),
    ];

    const situations = clusterEnrichedMovers(items);
    expect(situations).toHaveLength(1);
    expect(situations[0]?.kind).toBe("cluster");
    expect(situations[0]?.label).toBe("Auto Manufacturers");
    expect(situations[0]?.tickers).toHaveLength(2);
  });
});
