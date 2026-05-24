import { describe, expect, it } from "vitest";
import {
  classifyCatalystTypeFromHeadline,
  headlineMatchesKeyword,
} from "@workspace/movers-types";

describe("classifyCatalystTypeFromHeadline", () => {
  it("classifies earnings headlines", () => {
    expect(classifyCatalystTypeFromHeadline("Company beats earnings estimates for Q3")).toBe("EARNINGS");
  });

  it("classifies government headlines", () => {
    expect(classifyCatalystTypeFromHeadline("Department of Defense expands federal funding program")).toBe(
      "GOV",
    );
  });

  it("returns NONE for empty headline", () => {
    expect(classifyCatalystTypeFromHeadline("")).toBe("NONE");
    expect(classifyCatalystTypeFromHeadline("   ")).toBe("NONE");
  });

  it("returns UNKNOWN for non-keyword headlines (not SECTOR fallback)", () => {
    expect(classifyCatalystTypeFromHeadline("Why Futu Holdings stock is moving today")).toBe("UNKNOWN");
    expect(classifyCatalystTypeFromHeadline("Shares rise on heavy volume")).toBe("UNKNOWN");
  });

  it("returns SECTOR only on positive sector keyword match", () => {
    expect(classifyCatalystTypeFromHeadline("NVTS leads chip sector rally")).toBe("SECTOR");
    expect(classifyCatalystTypeFromHeadline("Stock moves with the sector")).toBe("SECTOR");
  });

  it("does not classify defense-sector compound as SECTOR", () => {
    expect(classifyCatalystTypeFromHeadline("Hyliion secures major defense-sector partnership")).toBe(
      "CONTRACT",
    );
    expect(classifyCatalystTypeFromHeadline("Hyliion rallies on defense-sector momentum")).toBe("UNKNOWN");
  });

  it("evaluates CONTRACT before SECTOR for contract headlines", () => {
    expect(classifyCatalystTypeFromHeadline("HYLN wins defense contract from US Army")).toBe("CONTRACT");
  });
});

describe("headlineMatchesKeyword", () => {
  it("does not match sector inside defense-sector", () => {
    expect(headlineMatchesKeyword("defense-sector partnership", "sector")).toBe(false);
  });

  it("matches sector as standalone token", () => {
    expect(headlineMatchesKeyword("stock sector rally", "sector")).toBe(true);
  });
});
