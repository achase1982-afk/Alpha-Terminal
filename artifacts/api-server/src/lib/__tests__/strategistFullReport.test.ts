import { describe, it, expect } from "vitest";
import { sanitizeReportDisplayText, repairDisplayRanges } from "../strategistFullReport/sanitizeReport.js";
import { validateReportProse, cleanReportProse } from "../strategistFullReport/validateProse.js";
import { buildBearCaseProse, looksLikeMaxProfitScenario, fmtUsd } from "../strategistFullReport/reportFormat.js";
import { streetTapeAlignment, computeTapeSignals } from "../strategistTapeSignals.js";
import {
  buildReportProseFromChips,
  buildRiskManagementProse,
  extractSectorPeerTickers,
  formatEarningsChipValue,
} from "../strategistFullReport/reportNarrative.js";
import type { NormalizedPriceTargetSnapshot } from "../strategistPriceTargetService.js";

describe("validateReportProse", () => {
  it("accepts prose containing digits", () => {
    const r = validateReportProse({
      confidenceRead: "Low conviction setup with no edge.",
      whyInPlay: "IVR 72 and P/C 0.72 support the trade.",
      thesisWithNumbers: "Susquehanna PT $700 vs spot $420.",
      streetVsTapeProse: "Tape and street agree.",
      idioMacroNote: "Idio 65% leads macro 35%.",
      sectorExposureNote: "Sector beta matters.",
      whyStructure: "Butterfly sells post-crush vol.",
      bearCase: "Gap below $407 loses the debit.",
      riskManagementProse: "Stop at 54% of max loss.",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects prose that is too short", () => {
    const bad = validateReportProse({
      confidenceRead: "Short",
      whyInPlay: "Vol is elevated.",
      thesisWithNumbers: "Structure fits the regime.",
      streetVsTapeProse: "Tape and street agree.",
      idioMacroNote: "Idio leads macro.",
      sectorExposureNote: "Sector beta matters.",
      whyStructure: "Spread defines risk.",
      bearCase: "Gap risk remains.",
      riskManagementProse: "Honor stops.",
    });
    expect(bad.ok).toBe(false);
  });

  it("cleanReportProse keeps digits", () => {
    const s = cleanReportProse("IVR 100 with 2.5 delta and PT $700");
    expect(s).toMatch(/\d/);
    expect(s).toContain("700");
  });
});

describe("sanitizeReportDisplayText", () => {
  it("removes URLs and underscores; em dash becomes sentence break", () => {
    const s = sanitizeReportDisplayText(
      "Read more at https://example.com/foo — vol_rich setup per www.bloomberg.com",
    );
    expect(s).not.toMatch(/https?:\/\//i);
    expect(s).not.toMatch(/www\./i);
    expect(s).not.toContain("—");
    expect(s).not.toContain("_");
    expect(s).toContain("vol rich");
    expect(s).toMatch(/\.\s+vol rich|\. vol rich/);
  });

  it("repairs dollar and month ranges", () => {
    expect(repairDisplayRanges("strikes $380 $390 on May 11 12")).toBe(
      "strikes $380–$390 on May 11–12",
    );
  });
});

describe("buildBearCaseProse", () => {
  it("excludes max-profit upside lines from bear case for bullish trades", () => {
    const body = buildBearCaseProse({
      direction: "BULLISH",
      riskOfRuin: "Macro gap through structure.",
      bullInvalidation: "Close above $460 caps profit on the fly.",
      bearInvalidation: "Close below $407 invalidates the bull put.",
    });
    expect(looksLikeMaxProfitScenario("Close above $460 caps profit")).toBe(true);
    expect(body).not.toMatch(/caps profit/i);
    expect(body).toMatch(/407|Macro gap/i);
  });
});

describe("streetTapeAlignment", () => {
  it("flags divergent rising vs distribution", () => {
    expect(streetTapeAlignment("rising", "distribution")).toBe("divergent");
  });
});

describe("computeTapeSignals flow bias", () => {
  it("classifies P/C 0.72 as call-heavy not mixed", () => {
    const tape = computeTapeSignals({
      signalPrice: 100,
      dailyChangePct: 0.5,
      putCallVolumeRatio: 0.72,
      residualZ: null,
      shortStrike: 95,
    });
    expect(tape.flowBias).toBe("call-buy/put-sell");
  });
});

describe("buildReportProseFromChips", () => {
  const emptyPt: NormalizedPriceTargetSnapshot = {
    available: false,
    asOfDate: null,
    consensusPT: null,
    ptHigh: null,
    ptLow: null,
    analystCount: null,
    ptVsSignalPct: null,
    revisions: { raises: 0, cuts: 0, windowDays: 90 },
    revisionTrend: "flat",
    recent: [],
  };

  it("matches profit chip wording in risk management prose", () => {
    const prose = buildRiskManagementProse({
      profitTargetPct: 33,
      profitTarget: 17.9,
      stopLossPct: 30,
      stopLoss: 8.5,
      timeStop: "2026-06-15",
    });
    expect(prose).toContain("33% of max");
    expect(prose).toContain("$17.90");
  });

  it("does not claim idiosyncratic dominance when macro leads", () => {
    const tape = computeTapeSignals({
      signalPrice: 100,
      dailyChangePct: 0,
      putCallVolumeRatio: 0.72,
      residualZ: 0.5,
      shortStrike: null,
    });
    const prose = buildReportProseFromChips({
      ticker: "DELL",
      ivr: 72,
      atmIvPct: 77.7,
      flowPc: 0.72,
      flowPcSource: "Polygon unusual flow",
      catalystInWindow: false,
      pt: {
        ...emptyPt,
        available: true,
        consensusPT: 379.25,
        analystCount: 6,
        ptVsSignalPct: 12,
        revisions: { raises: 15, cuts: 19, windowDays: 90 },
        revisionTrend: "falling",
        recent: [],
      },
      tape,
      alignment: "divergent",
      ioScore: {
        available: true,
        dataAvailability: { source: "real" },
        beta: 1.1,
        residualReturnZScore: 0.2,
        components: { marketIndependence: { rSquared: 0.45 } },
      } as never,
      ioRegressionAvailable: true,
      idioPct: 41,
      macroPct: 59,
      sector: "Technology Hardware",
      sectorPeers: ["HPQ", "HPE", "SMCI"],
      strategyName: "Bull put spread",
      direction: "BULLISH",
      nextEarningsDate: "2026-08-27",
      lastEarningsDate: "2026-05-28",
      earningsDaysAway: 90,
      enrichedExit: { profitTargetPct: 33, profitTarget: 17.9 },
      thesisFallback: "Post-earnings drift setup.",
    });
    expect(prose.idioMacroNote).toMatch(/Macro sleeve leads|Macro sleeve dominates/);
    expect(prose.idioMacroNote).not.toMatch(/almost entirely idiosyncratic/i);
    expect(prose.streetVsTapeProse).toMatch(/falling|downgrades/i);
    expect(prose.streetVsTapeProse).toMatch(/call-buy\/put-sell/);
    expect(prose.sectorExposureNote).toContain("HPQ");
  });
});

describe("formatEarningsChipValue", () => {
  it("shows last reported when next date is in the past", () => {
    const v = formatEarningsChipValue("2026-05-28", null, null, new Date("2026-05-29T12:00:00Z"));
    expect(v).toMatch(/Last/);
    expect(v).not.toMatch(/Next/);
  });

  it("shows both last and next when available", () => {
    const v = formatEarningsChipValue("2026-08-27", "2026-05-28", 90, new Date("2026-05-29T12:00:00Z"));
    expect(v).toMatch(/Last/);
    expect(v).toMatch(/Next/);
  });
});

describe("fmtUsd", () => {
  it("formats large amounts with grouping", () => {
    expect(fmtUsd(1205)).toBe("$1,205.00");
  });
});

describe("extractSectorPeerTickers", () => {
  it("pulls peer symbols from context text", () => {
    expect(extractSectorPeerTickers("Peers HPQ HPE SMCI vs DELL", "DELL")).toEqual([
      "HPQ",
      "HPE",
      "SMCI",
    ]);
  });
});
