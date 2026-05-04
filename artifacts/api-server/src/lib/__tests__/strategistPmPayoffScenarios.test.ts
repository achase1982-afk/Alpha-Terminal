import { describe, expect, it } from "vitest";
import { attachDeskPmPayoffScenarios } from "../strategistPmPayoffScenarios.js";
import type { DeskResult } from "../strategistDeskSchemas.js";

function minimalDeskTrade(): DeskResult {
  return {
    mode: "desk",
    ticker: "TEST",
    vol: {
      iv_state: "",
      term_structure: "",
      skew: "",
      implied_vs_realized: "",
      read: "",
    },
    flow: {
      dominant_flow: "",
      institutional_signal: "",
      retail_signal: "",
      key_strikes: [],
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
      structure: {
        type: "call_vertical",
        expiry: "2026-06-19",
        credit_or_debit: 2.5,
        legs: [
          { type: "call", strike: 100, action: "buy", expiration: "2026-06-19" },
          { type: "call", strike: 105, action: "sell", expiration: "2026-06-19" },
        ],
      },
      thesis: "",
      edge_check: "",
      deviation_from_analysts: "none",
      size: "small",
      whose_side: "neither",
      biggest_risk: "",
      exit_plan: { profit_target: 1, stop_loss: 1, time_stop: "" },
      watch_for: "",
    },
    models: { vol: "", flow: "", catalyst: "", pm: "" },
  };
}

describe("attachDeskPmPayoffScenarios", () => {
  it("returns 7 scenarios with summary when data package has chain inputs", () => {
    const desk = minimalDeskTrade();
    const dataPackage = JSON.stringify({
      price: 100,
      optionsChainSummary: {
        impliedMove: { dollar: 6, percentOfSpot: 6, expiry: "2026-06-19", daysToExpiry: 30 },
        termStructure5pt: [
          { expiry: "2026-06-19", daysToExpiry: 30, atmIV: 30 },
        ],
      },
    });

    const out = attachDeskPmPayoffScenarios(desk, dataPackage);
    expect(out.pm.scenarios).not.toBeNull();
    expect(out.pm.scenarios!.length).toBe(7);
    expect(out.pm.scenariosSummary).not.toBeNull();
    expect(out.pm.scenariosSummary!.peakPnlPrice).toBeGreaterThan(0);
  });

  it("sets null scenarios when implied move is missing (fallback step)", () => {
    const desk = minimalDeskTrade();
    const dataPackage = JSON.stringify({
      price: 100,
      optionsChainSummary: {
        termStructure5pt: [{ expiry: "2026-06-19", daysToExpiry: 30, atmIV: 30 }],
      },
    });

    const out = attachDeskPmPayoffScenarios(desk, dataPackage);
    expect(out.pm.scenarios?.length).toBe(7);
  });
});
