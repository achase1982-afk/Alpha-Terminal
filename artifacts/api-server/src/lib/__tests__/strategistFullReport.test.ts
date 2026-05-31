import { describe, it, expect } from "vitest";
import { sanitizeReportDisplayText } from "../strategistFullReport/sanitizeReport.js";
import { validateReportProse, cleanReportProse } from "../strategistFullReport/validateProse.js";
import { buildBearCaseProse, looksLikeMaxProfitScenario } from "../strategistFullReport/reportFormat.js";
import { streetTapeAlignment } from "../strategistTapeSignals.js";

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
  it("removes URLs, em dashes, and underscores", () => {
    const s = sanitizeReportDisplayText(
      "Read more at https://example.com/foo — vol_rich setup per www.bloomberg.com",
    );
    expect(s).not.toMatch(/https?:\/\//i);
    expect(s).not.toMatch(/www\./i);
    expect(s).not.toContain("—");
    expect(s).not.toContain("_");
    expect(s).toContain("vol rich");
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
