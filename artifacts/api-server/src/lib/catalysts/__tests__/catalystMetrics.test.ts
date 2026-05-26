import { describe, expect, it } from "vitest";
import { CATALYST_DRIFT_SESSION_COUNT } from "@workspace/catalysts-types";
import {
  buildPatternRead,
  computeSessionSnapshot,
  detectSuspectSessionMoves,
} from "../catalystMetrics.js";

describe("catalystMetrics", () => {
  it("computes 10-session relative drift vs SPY", () => {
    const sessionDates = [
      "2026-05-12",
      "2026-05-13",
      "2026-05-14",
      "2026-05-15",
      "2026-05-16",
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
      "2026-05-22",
      "2026-05-23",
    ];
    expect(sessionDates).toHaveLength(CATALYST_DRIFT_SESSION_COUNT);

    const stock = new Map<string, number>([
      ["2026-05-11", 100],
      ["2026-05-12", 102],
      ["2026-05-13", 104],
      ["2026-05-14", 106],
      ["2026-05-15", 108],
      ["2026-05-16", 110],
      ["2026-05-18", 112],
      ["2026-05-19", 114],
      ["2026-05-20", 116],
      ["2026-05-21", 118],
      ["2026-05-22", 120],
      ["2026-05-23", 122],
    ]);
    const spy = new Map<string, number>([
      ["2026-05-11", 500],
      ["2026-05-12", 500],
      ["2026-05-13", 500],
      ["2026-05-14", 500],
      ["2026-05-15", 500],
      ["2026-05-16", 500],
      ["2026-05-18", 500],
      ["2026-05-19", 500],
      ["2026-05-20", 500],
      ["2026-05-21", 500],
      ["2026-05-22", 500],
      ["2026-05-23", 500],
    ]);

    const snap = computeSessionSnapshot(sessionDates, stock, spy);
    expect(snap).not.toBeNull();
    expect(snap!.sessionMovesPct).toHaveLength(10);
    expect(snap!.cumulative10d).toBeGreaterThan(0);
    expect(snap!.streak).toBe(10);
  });

  it("returns choppy pattern when moves mixed", () => {
    const moves = [1, -1, 1, -1, 0.5, -0.5, 1, -1, 0.2, -0.2];
    expect(buildPatternRead(moves, 1)).toContain("Choppy");
  });

  it("flags and excludes suspect relative moves from cumulatives", () => {
    const moves = [1, 1, 1, 1, 1, 1, 1, 1, 1, 30];
    const suspect = detectSuspectSessionMoves(moves);
    expect(suspect[9]).toBe(true);
    expect(suspect.filter(Boolean)).toHaveLength(1);

    const sessionDates = [
      "2026-05-12",
      "2026-05-13",
      "2026-05-14",
      "2026-05-15",
      "2026-05-16",
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
      "2026-05-22",
      "2026-05-23",
    ];
    const stock = new Map<string, number>([
      ["2026-05-11", 100],
      ["2026-05-12", 101],
      ["2026-05-13", 102],
      ["2026-05-14", 103],
      ["2026-05-15", 104],
      ["2026-05-16", 105],
      ["2026-05-18", 106],
      ["2026-05-19", 107],
      ["2026-05-20", 108],
      ["2026-05-21", 109],
      ["2026-05-22", 110],
      ["2026-05-23", 140],
    ]);
    const spy = new Map<string, number>([
      ["2026-05-11", 500],
      ["2026-05-12", 500],
      ["2026-05-13", 500],
      ["2026-05-14", 500],
      ["2026-05-15", 500],
      ["2026-05-16", 500],
      ["2026-05-18", 500],
      ["2026-05-19", 500],
      ["2026-05-20", 500],
      ["2026-05-21", 500],
      ["2026-05-22", 500],
      ["2026-05-23", 500],
    ]);
    const snap = computeSessionSnapshot(sessionDates, stock, spy);
    expect(snap).not.toBeNull();
    expect(snap!.sessionSuspect[9]).toBe(true);
    expect(snap!.cumulative1d).toBeLessThan(25);
    expect(snap!.cumulative10d).toBeLessThan(40);
  });
});
