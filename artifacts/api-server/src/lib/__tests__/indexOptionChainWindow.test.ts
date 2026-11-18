import { describe, expect, it } from "vitest";
import {
  expirationInWindow,
  readChainRange,
  resolveIndexChainWindow,
  schwabStrikeCountPerSide,
} from "../indexOptionChainWindow.js";

describe("resolveIndexChainWindow", () => {
  const now = new Date("2026-11-18T16:30:00Z");

  it("converts a 40-strike ladder into 20 strikes per side", () => {
    expect(schwabStrikeCountPerSide(40)).toBe(20);
    expect(schwabStrikeCountPerSide(10)).toBe(5);
  });

  it("refuses to ask Schwab for more than 80 strikes per side", () => {
    expect(schwabStrikeCountPerSide(500)).toBe(80);
  });

  it("defaults an unnamed index request to a near expiration span, not the whole book", () => {
    const w = resolveIndexChainWindow({ strikeCount: 10, now });
    expect(w.fromDate).toBe("2026-11-18");
    expect(w.toDate).toBe("2026-12-09");
    expect(w.strikeCountPerSide).toBe(5);
    expect(w.range).toBe("NTM");
  });

  it("passes a directional scroll page through without halving it", () => {
    const above = resolveIndexChainWindow({
      fromDate: "2026-11-20",
      toDate: "2026-11-20",
      strikeCount: 40,
      range: "SAK",
      now,
    });
    expect(above.range).toBe("SAK");
    expect(above.strikeCountPerSide).toBe(40);
    expect(readChainRange("sbk")).toBe("SBK");
    expect(readChainRange("ALL")).toBe("NTM");
  });

  it("pins a named expiration to that session", () => {
    const w = resolveIndexChainWindow({
      fromDate: "2026-11-20T21:00:00.000Z",
      toDate: "2026-11-20",
      strikeCount: 40,
      now,
    });
    expect(w).toEqual({
      fromDate: "2026-11-20",
      toDate: "2026-11-20",
      strikeCountPerSide: 20,
      range: "NTM",
    });
    expect(expirationInWindow("2026-11-20T21:00:00.000Z", w)).toBe(true);
    expect(expirationInWindow("2026-12-18T21:00:00.000Z", w)).toBe(false);
  });
});
