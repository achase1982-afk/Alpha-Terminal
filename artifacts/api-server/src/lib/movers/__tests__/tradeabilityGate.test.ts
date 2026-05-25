import { describe, expect, it } from "vitest";
import { AVG_VOLUME_FLOOR } from "@workspace/movers-types";
import type { FmpCompanyProfile } from "../fmpCompanyProfile.js";
import { applyTradeabilityGate } from "../tradeabilityGate.js";

describe("applyTradeabilityGate", () => {
  it("filters low average volume and requires options when configured", () => {
    const profiles = new Map<string, FmpCompanyProfile>([
      [
        "LOWV",
        {
          symbol: "LOWV",
          marketCap: 2_000_000_000,
          sector: null,
          industry: null,
          description: null,
          averageVolume: AVG_VOLUME_FLOOR - 1,
        },
      ],
      [
        "GOOD",
        {
          symbol: "GOOD",
          marketCap: 2_000_000_000,
          sector: null,
          industry: null,
          description: null,
          averageVolume: AVG_VOLUME_FLOOR,
        },
      ],
    ]);

    const noOptProfiles = new Map(profiles);
    noOptProfiles.set("NOOPT", {
      symbol: "NOOPT",
      marketCap: 2_000_000_000,
      sector: null,
      industry: null,
      description: null,
      averageVolume: AVG_VOLUME_FLOOR + 1,
    });

    const { tradeable, filtered } = applyTradeabilityGate(
      [
        { symbol: "LOWV", name: "Low Vol Co", price: 20, changePct: 1 },
        { symbol: "NOOPT", name: "No Options Co", price: 20, changePct: 1 },
        { symbol: "GOOD", name: "Good Co", price: 20, changePct: 1 },
      ],
      noOptProfiles,
      { requireOptionsChain: true, symbolsWithOptions: new Set(["GOOD"]) },
    );

    expect(tradeable.map((t) => t.symbol)).toEqual(["GOOD"]);
    expect(filtered.some((f) => f.reason === "LOW_VOLUME")).toBe(true);
    expect(filtered.some((f) => f.reason === "NO_OPTIONS")).toBe(true);
  });
});
