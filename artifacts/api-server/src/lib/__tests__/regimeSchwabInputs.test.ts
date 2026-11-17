import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  equityDailyTable: {},
  desc: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  gte: vi.fn(),
  sql: Object.assign(vi.fn(), { join: vi.fn() }),
}));
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("../strategistSettings.js", () => ({ getSettings: vi.fn() }));
vi.mock("../schwabBatchQuotes.js", () => ({
  SCHWAB_MARKETDATA: "https://example.invalid/marketdata/v1",
  SCHWAB_QUOTES_BATCH_SIZE: 50,
  fetchSchwabBatchQuotesForSymbolsBestToken: vi.fn(),
}));
vi.mock("../tokenStore.js", () => ({ getBestAccessToken: vi.fn(() => "tok") }));

import { deriveDirectionalConviction, scoreCloseSeriesTrend } from "../regimePostProcessor.js";
import { clusterWeightCoverage, type ClusterResult, type ClusterName, type EngineOutput } from "../marketPulseEngine.js";
import { tallyExchange, ADD_SCALE_ISSUES, MIN_SAMPLE_PER_EXCHANGE } from "../syntheticBreadth.js";
import { parseIndexQuoteEntry, registerSchwabIndexSymbols, selectPollSymbols, __resetSchwabIndexQuotes } from "../schwabIndexQuotes.js";

function cluster(score: number, dataQuality: ClusterResult["dataQuality"] = "FRESH"): ClusterResult {
  return { score, raw: score, dataQuality, direction: "FLAT", headline: "", keyDataPoints: [], rulesApplied: [] };
}

function pulse(overrides: Partial<Record<ClusterName, ClusterResult>>, structuralRegime = "RANGE"): EngineOutput {
  const base: Record<ClusterName, ClusterResult> = {
    rates: cluster(0, "MISSING"),
    credit: cluster(0, "MISSING"),
    volLevel: cluster(0, "MISSING"),
    volTerm: cluster(0, "MISSING"),
    breadth: cluster(0, "MISSING"),
    riskAppetite: cluster(0, "MISSING"),
    macro: cluster(0, "MISSING"),
  };
  return { clusters: { ...base, ...overrides }, structuralRegime } as unknown as EngineOutput;
}

describe("directional conviction with clusters dark", () => {
  it("does not let a missing breadth cluster vote flat against live bullish clusters", () => {
    // Risk appetite strongly bullish, everything else dark. The old weighting
    // averaged in zeros at full weight and produced NEUTRAL.
    const p = pulse({ riskAppetite: cluster(1.8) });
    expect(deriveDirectionalConviction(p)).toBe("BULLISH");
  });

  it("is unchanged from the old full-weight formula when every cluster has data", () => {
    // 1.5(.30) + 1.4(.30) + 0.8(.20) + 0.5(.20) = 1.13, just under the 1.2 line.
    const near = pulse({ riskAppetite: cluster(1.5), breadth: cluster(1.4), rates: cluster(0.8), macro: cluster(0.5) });
    expect(deriveDirectionalConviction(near)).toBe("MODERATELY_BULLISH");
    // 1.8(.30) + 1.6(.30) + 1.0(.20) + 0.6(.20) = 1.34, over it.
    const over = pulse({ riskAppetite: cluster(1.8), breadth: cluster(1.6), rates: cluster(1.0), macro: cluster(0.6) });
    expect(deriveDirectionalConviction(over)).toBe("BULLISH");
  });

  it("returns NEUTRAL when nothing directional has data at all", () => {
    expect(deriveDirectionalConviction(pulse({}))).toBe("NEUTRAL");
  });

  it("lets the index trend term speak when every cluster is dark", () => {
    expect(deriveDirectionalConviction(pulse({}), 1.6)).toBe("BULLISH");
    expect(deriveDirectionalConviction(pulse({}), -1.5)).toBe("BEARISH");
  });

  it("keeps TRANSITION ahead of any score", () => {
    expect(deriveDirectionalConviction(pulse({ riskAppetite: cluster(2) }), null)).toBe("BULLISH");
    expect(deriveDirectionalConviction(pulse({ riskAppetite: cluster(2) }, "TRANSITION"), null)).toBe("TRANSITION");
  });

  it("a live cluster that genuinely reads flat still counts", () => {
    // Zero with FRESH data is a real reading and must dilute the bullish vote.
    const p = pulse({ riskAppetite: cluster(1.8), breadth: cluster(0, "FRESH"), rates: cluster(0, "FRESH"), macro: cluster(0, "FRESH") });
    expect(deriveDirectionalConviction(p)).toBe("MODERATELY_BULLISH");
  });
});

describe("cluster weight coverage", () => {
  it("reports zero when the whole pulse is dark", () => {
    expect(clusterWeightCoverage(pulse({}).clusters)).toBe(0);
  });

  it("reports the live share of cluster weight", () => {
    // breadth 18 + riskAppetite 15 of 100 total.
    const c = pulse({ breadth: cluster(1), riskAppetite: cluster(1) }).clusters;
    expect(clusterWeightCoverage(c)).toBeCloseTo(0.33, 2);
  });
});

describe("index trend from daily closes", () => {
  it("returns null without enough bars", () => {
    expect(scoreCloseSeriesTrend([1, 2, 3])).toBeNull();
  });

  it("scores a steady uptrend positive and a downtrend negative", () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    const down = Array.from({ length: 30 }, (_, i) => 200 - i);
    expect(scoreCloseSeriesTrend(up)!).toBeGreaterThan(0.5);
    expect(scoreCloseSeriesTrend(down)!).toBeLessThan(-0.5);
  });

  it("scores a flat tape near zero", () => {
    const flat = Array.from({ length: 30 }, () => 100);
    expect(Math.abs(scoreCloseSeriesTrend(flat)!)).toBeLessThan(0.3);
  });
});

describe("Liquid Core breadth proxy", () => {
  const q = (symbol: string, changePct: number | null, volume: number | null) => ({ symbol, changePct, volume });

  it("refuses a sample too small to mean anything", () => {
    expect(tallyExchange([q("A", 1, 100), q("B", -1, 100)])).toBeNull();
  });

  it("counts advancers, decliners, and their volume", () => {
    const quotes = [
      ...Array.from({ length: 30 }, (_, i) => q(`UP${i}`, 1.5, 1000)),
      ...Array.from({ length: 10 }, (_, i) => q(`DN${i}`, -1.2, 500)),
    ];
    const t = tallyExchange(quotes)!;
    expect(t.advn).toBe(30);
    expect(t.decn).toBe(10);
    expect(t.uvol).toBe(30_000);
    expect(t.dvol).toBe(5_000);
    expect(t.sampleSize).toBe(40);
  });

  it("scales the net-advance line to a notional full exchange", () => {
    const quotes = [
      ...Array.from({ length: 30 }, (_, i) => q(`UP${i}`, 1, 10)),
      ...Array.from({ length: 10 }, (_, i) => q(`DN${i}`, -1, 10)),
    ];
    // 20 net of 40 directional names = half the exchange advancing.
    expect(tallyExchange(quotes)!.add).toBe(ADD_SCALE_ISSUES / 2);
  });

  it("computes TRIN as the ratio of the issue ratio to the volume ratio", () => {
    const quotes = [
      ...Array.from({ length: 20 }, (_, i) => q(`UP${i}`, 1, 1000)),
      ...Array.from({ length: 20 }, (_, i) => q(`DN${i}`, -1, 2000)),
    ];
    // issues 1.0, volume 0.5 → TRIN 2.0, a heavy-selling reading.
    expect(tallyExchange(quotes)!.trin).toBe(2);
  });

  it("treats unchanged names as neither side", () => {
    const quotes = [
      ...Array.from({ length: 20 }, (_, i) => q(`UP${i}`, 1, 10)),
      ...Array.from({ length: 5 }, (_, i) => q(`FL${i}`, 0, 10)),
    ];
    const t = tallyExchange(quotes)!;
    expect(t.unchanged).toBe(5);
    expect(t.advn).toBe(20);
    expect(t.decn).toBe(0);
  });

  it("skips unpriced names rather than counting them flat", () => {
    const quotes = Array.from({ length: MIN_SAMPLE_PER_EXCHANGE - 1 }, (_, i) => q(`UP${i}`, 1, 10)).concat([q("X", null, 10)]);
    expect(tallyExchange(quotes)).toBeNull();
  });
});

describe("Schwab index quotes", () => {
  beforeEach(() => __resetSchwabIndexQuotes());

  it("parses an index quote envelope", () => {
    const parsed = parseIndexQuoteEntry("$VIX", {
      quote: { lastPrice: 17.4, closePrice: 16.0, netChange: 1.4, netPercentChange: 8.75, highPrice: 18, lowPrice: 16.2 },
    });
    expect(parsed).toMatchObject({ symbol: "$VIX", last: 17.4, close: 16.0, change: 1.4, changePct: 8.75 });
  });

  it("derives change from the previous close when Schwab omits it", () => {
    const parsed = parseIndexQuoteEntry("$VIX9D", { quote: { lastPrice: 11, closePrice: 10 } })!;
    expect(parsed.change).toBe(1);
    expect(parsed.changePct).toBeCloseTo(10, 6);
  });

  it("returns null for an entry with no price", () => {
    expect(parseIndexQuoteEntry("$TICK", { quote: {} })).toBeNull();
    expect(parseIndexQuoteEntry("$TICK", undefined)).toBeNull();
  });

  it("polls every registered symbol until one is parked", () => {
    registerSchwabIndexSymbols(["$VIX", "$vix", "  $TICK  "]);
    expect(selectPollSymbols().sort()).toEqual(["$TICK", "$VIX"]);
  });
});
