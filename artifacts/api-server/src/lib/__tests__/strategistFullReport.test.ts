import { describe, it, expect } from "vitest";
import { sanitizeReportDisplayText } from "../strategistFullReport/sanitizeReport.js";
import { validateReportProse, stripDigitsFromProse } from "../strategistFullReport/validateProse.js";
import { streetTapeAlignment } from "../strategistTapeSignals.js";

describe("validateReportProse", () => {
  it("rejects prose containing digits", () => {
    const r = validateReportProse({
      confidenceRead: "Low conviction setup with no edge.",
      whyInPlay: "Vol is elevated.",
      thesisWithNumbers: "Structure fits the regime.",
      streetVsTapeProse: "Tape and street agree.",
      idioMacroNote: "Idio leads macro.",
      sectorExposureNote: "Sector beta matters.",
      whyStructure: "Spread defines risk.",
      bearCase: "Gap risk remains.",
      riskManagementProse: "Honor stops.",
    });
    expect(r.ok).toBe(true);
    const bad = validateReportProse({
      confidenceRead: "Score is 56",
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

  it("strips digits for fallback synthesis", () => {
    expect(stripDigitsFromProse("IVR 100 with 2.5 delta")).not.toMatch(/\d/);
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

describe("streetTapeAlignment", () => {
  it("flags divergent rising vs distribution", () => {
    expect(streetTapeAlignment("rising", "distribution")).toBe("divergent");
  });
});
