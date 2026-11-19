import { describe, expect, it } from "vitest";
import {
  isEquityQuoteRestSessionActive,
  isSpxDeskProductSessionActive,
} from "../deskFeedSessions.js";

function et(iso: string): Date {
  return new Date(iso);
}

describe("deskFeedSessions", () => {
  it("SPX GTH evening Sunday", () => {
    expect(isSpxDeskProductSessionActive(et("2026-11-15T21:00:00-05:00"))).toBe(true);
  });

  it("SPX RTH Monday", () => {
    expect(isSpxDeskProductSessionActive(et("2026-11-17T10:30:00-05:00"))).toBe(true);
  });

  it("SPX curb Monday", () => {
    expect(isSpxDeskProductSessionActive(et("2026-11-17T16:10:00-05:00"))).toBe(true);
  });

  it("SPX closed Monday mid-afternoon gap", () => {
    expect(isSpxDeskProductSessionActive(et("2026-11-17T17:30:00-05:00"))).toBe(false);
  });

  it("SPX GTH morning Monday", () => {
    expect(isSpxDeskProductSessionActive(et("2026-11-17T08:00:00-05:00"))).toBe(true);
  });

  it("SPX stays active across the 9:25-9:30 handoff", () => {
    expect(isSpxDeskProductSessionActive(et("2026-11-17T09:27:00-05:00"))).toBe(true);
  });

  it("equity pre-market active", () => {
    expect(isEquityQuoteRestSessionActive(et("2026-11-17T08:00:00-05:00"))).toBe(true);
  });

  it("equity post-market active", () => {
    expect(isEquityQuoteRestSessionActive(et("2026-11-17T17:00:00-05:00"))).toBe(true);
  });

  it("equity overnight closed", () => {
    expect(isEquityQuoteRestSessionActive(et("2026-11-17T22:00:00-05:00"))).toBe(false);
  });
});