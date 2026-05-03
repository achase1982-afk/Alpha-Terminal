import { describe, it, expect, vi, afterEach } from "vitest";
import { mergeIOCatalystFromDesk } from "../ioScoreEngine.js";
import type { CatalystEvaluation } from "../catalystEvaluator.js";

function deskEval(over: Partial<CatalystEvaluation>): CatalystEvaluation {
  return {
    catalystInWindow: true,
    catalystType: "EARNINGS",
    catalystDate: "2026-05-10",
    catalystAlignment: "NEUTRAL",
    catalystScope: "NAME_SPECIFIC",
    scheduledEvents: [],
    ...over,
  };
}

describe("mergeIOCatalystFromDesk", () => {
  it("returns no_catalyst_in_window when desk says out of window", () => {
    const base = { flagValue: 0.5, reason: "analyst_cluster" };
    const ev = deskEval({ catalystInWindow: false });
    expect(mergeIOCatalystFromDesk(base, ev, 4)).toEqual({
      flagValue: 0,
      reason: "no_catalyst_in_window",
    });
  });

  it("uses imminent band for earnings within 48h (<=2 calendar days)", () => {
    const base = { flagValue: 0, reason: "none" };
    const ev = deskEval({ catalystType: "EARNINGS" });
    expect(mergeIOCatalystFromDesk(base, ev, 1)).toEqual({
      flagValue: 1.0,
      reason: "catalyst_imminent_within_48h",
    });
  });

  it("uses desk window partial credit for earnings 3–7 days out", () => {
    const base = { flagValue: 0, reason: "none" };
    const ev = deskEval({ catalystType: "EARNINGS" });
    expect(mergeIOCatalystFromDesk(base, ev, 4)).toEqual({
      flagValue: 0.6,
      reason: "catalyst_in_desk_window",
    });
  });

  it("uses extended window partial credit for earnings >7 days", () => {
    const base = { flagValue: 0, reason: "none" };
    const ev = deskEval({ catalystType: "EARNINGS" });
    expect(mergeIOCatalystFromDesk(base, ev, 12)).toEqual({
      flagValue: 0.3,
      reason: "catalyst_in_extended_window",
    });
  });

  it("falls back to base when desk eval is null", () => {
    const base = { flagValue: 0.5, reason: "analyst_cluster" };
    expect(mergeIOCatalystFromDesk(base, null, 4)).toEqual(base);
  });

  it("keeps stronger analyst signal over weaker desk extended band", () => {
    const base = { flagValue: 0.5, reason: "analyst_cluster" };
    const ev = deskEval({ catalystType: "EARNINGS" });
    expect(mergeIOCatalystFromDesk(base, ev, 20)).toEqual(base);
  });

  it("grades non-earnings primary by catalystDate when present", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T12:00:00.000Z"));
    const base = { flagValue: 0, reason: "none" };
    const ev = deskEval({
      catalystType: "FED_MEETING",
      catalystDate: "2026-05-08",
    });
    expect(mergeIOCatalystFromDesk(base, ev, null)).toEqual({
      flagValue: 0.6,
      reason: "catalyst_in_desk_window",
    });
    vi.useRealTimers();
  });
});

afterEach(() => {
  vi.useRealTimers();
});
