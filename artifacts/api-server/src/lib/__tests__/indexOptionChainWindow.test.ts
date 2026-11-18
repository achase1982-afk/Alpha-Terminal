import { describe, expect, it } from "vitest";
import {
  expirationInWindow,
  readChainRange,
  resolveIndexChainWindow,
  schwabStrikeCountPerSide,
} from "../indexOptionChainWindow.js";

describe("resolveIndexChainWindow", () => {
  const now = new Date("2026-11-18T16:30:00Z");

  it("passes the full centered strike count to Schwab (40 = 20 above + 20 below)", () => {
    expect(schwabStrikeCountPerSide(40)).toBe(40);
    expect(schwabStrikeCountPerSide(10)).toBe(10);
  });

  it("caps single-expiry requests at 160 total strikes (80 per side) and multi-expiry at 80", () => {
    expect(schwabStrikeCountPerSide(500, true)).toBe(160);
    expect(schwabStrikeCountPerSide(500, false)).toBe(80);
  });

  it("defaults an unnamed index request to a near expiration span, not the whole book", () => {
    const w = resolveIndexChainWindow({ strikeCount: 10, now });
    expect(w.fromDate).toBe("2026-11-18");
    expect(w.toDate).toBe("2026-12-09");
    expect(w.strikeCountPerSide).toBe(10);
    expect(w.range).toBe("NTM");
  });

  it("passes a directional scroll page through without halving it", () => {
    const above = resolveIndexChainWindow({
      fromDate: "2026-11-20",
      toDate: "2026-11-20",
      strikeCount: 80,
      range: "SAK",
      now,
    });
    expect(above.range).toBe("SAK");
    expect(above.strikeCountPerSide).toBe(80);
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
      strikeCountPerSide: 40,
      range: "NTM",
    });
    expect(expirationInWindow("2026-11-20T21:00:00.000Z", w)).toBe(true);
    expect(expirationInWindow("2026-12-18T21:00:00.000Z", w)).toBe(false);
  });
});
