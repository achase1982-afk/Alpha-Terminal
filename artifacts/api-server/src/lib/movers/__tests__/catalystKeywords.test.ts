import { describe, expect, it } from "vitest";
import { classifyCatalystTypeFromHeadline } from "@workspace/movers-types";

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
  });
});
