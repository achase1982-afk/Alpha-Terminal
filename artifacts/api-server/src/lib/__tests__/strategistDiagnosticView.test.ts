import { describe, expect, it } from "vitest";
import { buildStrategistDiagnosticView } from "../strategistDiagnosticView.js";
import type { DeskResult } from "../strategistDeskSchemas.js";

const minimalDesk: DeskResult = {
  mode: "desk",
  ticker: "TEST",
  vol: { iv_state: "", term_structure: "", skew: "", implied_vs_realized: "", read: "" },
  flow: {
    dominant_flow: "",
    institutional_signal: "",
    retail_signal: "",
    key_strikes: [
      { strike: 100, expiry: "2026-06-19", type: "call", observation: "x".repeat(250) },
    ],
    read: "",
  },
  catalyst: {
    primary_catalyst: "",
    bar_to_clear: "",
    asymmetry: "",
    historical_pattern: "",
    read: "",
  },
  pm: {
    decision: "trade",
    structure: { type: "bull_call_spread", legs: [], expiry: "2026-06-19", credit_or_debit: -1.5 },
    thesis: "Thesis line",
    edge_check: "Edge",
    deviation_from_analysts: "",
    size: "small",
    whose_side: "neither",
    biggest_risk: "Risk",
    exit_plan: { profit_target: 1, stop_loss: 2, time_stop: "dte" },
    watch_for: "Watch",
  },
  models: { vol: "m1", flow: "m2", catalyst: "m3", pm: "m4" },
};

const dataPackage = JSON.stringify({
  schemaVersion: 1,
  currentDate: "2026-05-01",
  price: 123.45,
  ivr: 42,
  ivrContext: { source: "canonical", asOfDate: "2026-04-30", daysOfHistory: 200 },
  dataQualitySummary: {
    marketSession: "RTH",
    marketSessionSource: "schwab",
    flags: ["skew_uncertain"],
    data_source_gaps: ["equity_daily_history_insufficient: 3 of 16 quarters have usable price reaction data"],
    flow: {
      tapeBackfillStatus: "complete",
      tapeBackfillReason: "live_complete",
      tapeBackfillTruncated: false,
      tapeBackfillOccRequested: 10,
      tapeBackfillOccCompleted: 10,
      tapeBackfillWsOccSubscribed: 4,
      tapeBackfillDedupeDropsTotal: 2,
    },
  },
  optionsChainSummary: {
    termStructure5pt: [{ expiry: "2026-06-19", daysToExpiry: 45, atmIV: 30 }],
    skew25Delta: { putIV: 31, callIV: 29, skewPoints: 2, asOfExpiry: "2026-06-19" },
    skew25DeltaReason: "clean_25d_first_expiry",
    impliedMove: { expiry: "2026-06-19", daysToExpiry: 45, dollar: 5, percentOfSpot: 4 },
    impliedMoveQuality: { available: true, reason: "ok", fallbackExpiryUsed: null },
    ivChainFilter: {
      ivCleanedRatio: 0.9,
      ivCleanedRatioFullChain: 0.85,
      ivClampedReasons: { oneSidedMarket: 2, ceilingClamp: 0 },
    },
  },
  polygonFlowHighlights: {
    totalCallVolume: 1000,
    totalPutVolume: 800,
    putCallVolumeRatio: 0.8,
    sessionTape: {
      aggressorSessionTotals: {
        askCount: 1,
        bidCount: 2,
        midCount: 0,
        unknownCount: 1,
        totalPrints: 4,
        knownPct: 75,
        askNotionalUsd: 0,
        bidNotionalUsd: 0,
        midNotionalUsd: 0,
        unknownNotionalUsd: 0,
      },
    },
  },
  realizedVol: { hv20: 0.22, hv30: 0.24, asOfDate: "2026-04-30" },
  catalyst: {
    earnings_reaction_summary: { quarters_total: 16, quarters_usable_price_reaction: 3 },
  },
});

describe("buildStrategistDiagnosticView", () => {
  it("projects desk + parsed package fields", () => {
    const v = buildStrategistDiagnosticView({
      dataPackageStr: dataPackage,
      deskResult: minimalDesk,
      catalystEvaluation: {
        catalystInWindow: true,
        catalystType: "EARNINGS",
        catalystDate: "2026-05-10",
        catalystAlignment: "ALIGNED",
        catalystScope: "NAME_SPECIFIC",
        scheduledEvents: [],
      },
      diag: { closingImbalancePresent: true, closingImbalanceLatencyMs: 120 },
    });
    expect(v.ticker).toBe("TEST");
    expect(v.spot).toBe(123.45);
    expect(v.decision).toBe("recommend");
    expect(v.structure).toContain("bull_call_spread");
    expect(v.ivr).toBe(42);
    expect(v.ivrHistoryDays).toBe(200);
    expect(v.atmIvByExpiry[0]?.expiration).toBe("2026-06-19");
    expect(v.skew25Delta?.putIv).toBe(31);
    expect(v.impliedMove?.available).toBe(true);
    expect(v.realizedVol?.hv20).toBe(0.22);
    expect(v.aggressorMix.ask).toBeCloseTo(0.25);
    expect(v.keyStrikes[0]?.observation.endsWith("…")).toBe(true);
    expect(v.tapeBackfillStatus).toBe("complete");
    expect(v.wsOccSubscribed).toBe(4);
    expect(v.primaryCatalystDate).toBe("2026-05-10");
    expect(v.daysToCatalyst).toBe(9);
    expect(v.earningsReactionSummary.quarters_total).toBe(16);
    expect(v.catalystGaps.length).toBe(1);
    expect(v.dataQualityFlags).toContain("skew_uncertain");
    expect(v.closingImbalancePresent).toBe(true);
    expect(v.closingImbalanceLatencyMs).toBe(120);
    expect(v.ivContaminationFlags).toContain("oneSidedMarket");
    expect(v.thesis).toBe("Thesis line");
  });

  it("maps PM incomplete to fail", () => {
    const v = buildStrategistDiagnosticView({
      dataPackageStr: "{}",
      deskResult: { ...minimalDesk, pmOutputIncomplete: true },
    });
    expect(v.decision).toBe("fail");
  });
});
