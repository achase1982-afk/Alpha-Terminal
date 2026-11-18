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
  it("parses slash-prefixed futures", () => {
    const r = parseDeskFlowSymbol("/ES");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.parsed.kind).toBe("futures");
      expect(r.parsed.sym).toBe("/ES");
    }
  });

  it("rejects bare root without slash", () => {
    const r = parseDeskFlowSymbol("ES");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.parsed.kind).toBe("equity");
  });

  it("parses $VIX index style tickers", () => {
    const r = parseDeskFlowSymbol("$VIX");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.parsed.sym).toBe("VIX");
  });

  it("parses class shares in dot and slash form", () => {
    const dot = parseDeskFlowSymbol("BRK.B");
    expect(dot.ok).toBe(true);
    if (dot.ok) {
      expect(dot.parsed.kind).toBe("equity");
      expect(dot.parsed.sym).toBe("BRK.B");
    }
    const slash = parseDeskFlowSymbol("BRK/B");
    expect(slash.ok).toBe(true);
    if (slash.ok) {
      expect(slash.parsed.kind).toBe("equity");
      expect(slash.parsed.sym).toBe("BRK/B");
    }
  });
});