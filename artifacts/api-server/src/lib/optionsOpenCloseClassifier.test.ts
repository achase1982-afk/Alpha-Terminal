import { describe, expect, it } from "vitest";
import { classifyOpenCloseFromOpraConditions } from "./optionsOpenCloseClassifier.js";

describe("classifyOpenCloseFromOpraConditions", () => {
  it("returns unknown for null, undefined, or empty conditions", () => {
    expect(classifyOpenCloseFromOpraConditions(null)).toBe("unknown");
    expect(classifyOpenCloseFromOpraConditions(undefined)).toBe("unknown");
    expect(classifyOpenCloseFromOpraConditions([])).toBe("unknown");
  });

  it("returns unknown for documented Polygon unified ids until explicit open/close maps exist", () => {
    // Per Polygon GET /v3/reference/conditions (options, trade): examples from published docs / API.
    expect(classifyOpenCloseFromOpraConditions([209])).toBe("unknown"); // Automatic Execution
    expect(classifyOpenCloseFromOpraConditions([219])).toBe("unknown"); // Intermarket Sweep Order
    expect(classifyOpenCloseFromOpraConditions([248])).toBe("unknown"); // Extended Hours Trade
  });

  it("skips non-finite condition values", () => {
    expect(classifyOpenCloseFromOpraConditions([Number.NaN, 209])).toBe("unknown");
  });
});
