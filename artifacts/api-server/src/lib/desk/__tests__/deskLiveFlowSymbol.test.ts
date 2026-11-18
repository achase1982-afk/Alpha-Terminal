import { describe, expect, it } from "vitest";
import { parseDeskFlowSymbol } from "../deskLiveFlowSymbol.js";

describe("parseDeskFlowSymbol", () => {
  it("parses SPX options stream", () => {
    expect(parseDeskFlowSymbol("SPX").ok).toBe(true);
  });
  it("parses equity tickers", () => {
    const r = parseDeskFlowSymbol("nvda");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.parsed.kind).toBe("equity");
      expect(r.parsed.sym).toBe("NVDA");
    }
  });
  it("parses futures", () => {
    const r = parseDeskFlowSymbol("ES");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.parsed.kind).toBe("futures");
      expect(r.parsed.sym).toBe("/ES");
    }
  });
});