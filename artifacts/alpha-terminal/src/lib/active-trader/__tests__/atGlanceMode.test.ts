import { describe, expect, it } from "vitest";
import { resolveAtGlanceMode } from "../atGlanceMode";

describe("resolveAtGlanceMode", () => {
  it("detects futures from slash prefix", () => {
    expect(resolveAtGlanceMode("/ES")).toBe("futures");
  });
  it("detects SPX index", () => {
    expect(resolveAtGlanceMode("$SPX")).toBe("index");
    expect(resolveAtGlanceMode("SPXW")).toBe("index");
  });
  it("defaults to stock", () => {
    expect(resolveAtGlanceMode("NVDA")).toBe("stock");
    expect(resolveAtGlanceMode("AAPL")).toBe("stock");
  });
});