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
  it("clusters only tickers on the curated theme map present in the feed (≥2)", () => {
    const items = [
      enriched("RGTI", "Rigetti Computing, Inc.", "Computer Hardware", 40),
      enriched("IONQ", "IonQ, Inc.", "Semiconductors", 25),
      enriched("QUBT", "Quantum Computing Inc.", "Software", 20),
      enriched("INFQ", "Infleqtion Inc.", "Technology", 18),
    ];

    const situations = clusterEnrichedMovers(items);
    const quantum = situations.find((s) => s.kind === "cluster" && s.label === "Quantum Computing");

    expect(quantum).toBeDefined();
    expect(quantum?.tickers.map((t) => t.symbol).sort()).toEqual(["INFQ", "IONQ", "QUBT", "RGTI"]);
    expect(situations.filter((s) => s.kind === "single")).toHaveLength(0);
  });

  it("does not cluster by FMP industry — HPQ stays single, QUBT joins quantum when co-present", () => {
    const items = [
      enriched("RGTI", "Rigetti Computing, Inc.", "Computer Hardware", 40),
      enriched("IONQ", "IonQ, Inc.", "Computer Hardware", 25),
      enriched("HPQ", "HP Inc.", "Computer Hardware", 15),
      enriched("QUBT", "Quantum Computing Inc.", "Software", 20),
    ];

    const situations = clusterEnrichedMovers(items);
    const quantum = situations.find((s) => s.kind === "cluster" && s.label === "Quantum Computing");
    const hpq = situations.find((s) => s.tickers[0]?.symbol === "HPQ");

    expect(quantum?.tickers.map((t) => t.symbol).sort()).toEqual(["IONQ", "QUBT", "RGTI"]);
    expect(hpq?.kind).toBe("single");
    expect(quantum?.tickers.some((t) => t.symbol === "HPQ")).toBe(false);
  });

  it("does not cluster same-industry names absent from the theme map (e.g. semis)", () => {
    const items = [
      enriched("NVTS", "Navitas Semiconductor", "Semiconductors", 20),
      enriched("NVDA", "NVIDIA Corporation", "Semiconductors", -1.9),
      enriched("INTC", "Intel Corporation", "Semiconductors", 1),
    ];

    const situations = clusterEnrichedMovers(items);
    expect(situations.every((s) => s.kind === "single")).toBe(true);
    expect(situations).toHaveLength(3);
  });

  it("leaves a lone theme-map ticker as single when no peer is in the feed", () => {
    const items = [enriched("QUBT", "Quantum Computing Inc.", "Software", 20)];

    const situations = clusterEnrichedMovers(items);
    expect(situations).toHaveLength(1);
    expect(situations[0]?.kind).toBe("single");
    expect(situations[0]?.tickers[0]?.symbol).toBe("QUBT");
  });

  it("never adds tickers that are not in the feed to a cluster", () => {
    const items = [enriched("RGTI", "Rigetti Computing, Inc.", "Computer Hardware", 40)];

    const situations = clusterEnrichedMovers(items);
    expect(situations).toHaveLength(1);
    expect(situations[0]?.kind).toBe("single");
    expect(situations[0]?.tickers).toHaveLength(1);
  });
});
