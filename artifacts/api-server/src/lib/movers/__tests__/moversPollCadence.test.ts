import { describe, expect, it } from "vitest";
import {
  MOVERS_POLL_INTERVAL_CLOSED_MS,
  MOVERS_POLL_INTERVAL_MS,
} from "@workspace/movers-types";
import { isExtendedEquitySessionActive, moversPollIntervalMs } from "../moversPollCadence.js";

describe("moversPollCadence", () => {
  it("treats premarket, open, and afterhours as active session", () => {
    expect(isExtendedEquitySessionActive("PREMARKET")).toBe(true);
    expect(isExtendedEquitySessionActive("OPEN")).toBe(true);
    expect(isExtendedEquitySessionActive("AFTERHOURS")).toBe(true);
    expect(isExtendedEquitySessionActive("CLOSED")).toBe(false);
  });

  it("uses 60s cadence during regular hours on a weekday", () => {
    const wed10et = new Date("2026-05-20T14:30:00-04:00");
    expect(moversPollIntervalMs(wed10et)).toBe(MOVERS_POLL_INTERVAL_MS);
  });

  it("uses 15m cadence when market is fully closed", () => {
    const satNoon = new Date("2026-05-23T12:00:00-04:00");
    expect(moversPollIntervalMs(satNoon)).toBe(MOVERS_POLL_INTERVAL_CLOSED_MS);
  });
});
