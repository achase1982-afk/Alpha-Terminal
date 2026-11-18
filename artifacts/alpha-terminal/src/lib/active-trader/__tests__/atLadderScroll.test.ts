import { describe, expect, it } from "vitest";
import {
  atLadderNudgeToClearSheet,
  atLadderRowFullyVisible,
  atLadderRowOffsetFromBand,
  atLadderScrollShiftForRows,
  atLadderScrollTopForRow,
  atLadderVisibleRowRange,
} from "@/lib/active-trader/atLadderScroll";

const ROW = 38;

describe("ladder scroll math", () => {
  it("finds the visible rows from scrollTop alone", () => {
    expect(atLadderVisibleRowRange({ scrollTop: 0, viewportPx: 648, rowHeight: ROW, rowCount: 41 })).toEqual({
      first: 0,
      last: 17,
    });
    expect(atLadderVisibleRowRange({ scrollTop: 456, viewportPx: 648, rowHeight: ROW, rowCount: 41 })).toEqual({
      first: 12,
      last: 29,
    });
    // Scrolled into the padding past the last strike: clamp to the last row.
    expect(atLadderVisibleRowRange({ scrollTop: 1500, viewportPx: 648, rowHeight: ROW, rowCount: 41 })).toEqual({
      first: 39,
      last: 40,
    });
    expect(atLadderVisibleRowRange({ scrollTop: 0, viewportPx: 648, rowHeight: ROW, rowCount: 0 })).toBeNull();
  });

  it("centers the spot row on the band and clamps at the ends", () => {
    const v = { viewportPx: 648, rowHeight: ROW, rowCount: 41 };
    const top = atLadderScrollTopForRow(20, v);
    expect(top).toBe(Math.round(20 * ROW + ROW / 2 - 648 * 0.42));
    expect(Math.abs(atLadderRowOffsetFromBand(20, { ...v, scrollTop: top }))).toBeLessThan(1);
    expect(atLadderScrollTopForRow(0, v)).toBe(0);
    expect(atLadderScrollTopForRow(40, v)).toBe(41 * ROW - 648);
  });

  it("knows when a row is fully on screen", () => {
    const v = { scrollTop: 380, viewportPx: 440, rowHeight: ROW, rowCount: 41 };
    expect(atLadderRowFullyVisible(10, v)).toBe(true);
    expect(atLadderRowFullyVisible(9, v)).toBe(false);
    expect(atLadderRowFullyVisible(21, v)).toBe(false);
  });

  it("nudges only rows that the order sheet would cover, and only as far as needed", () => {
    const v = { scrollTop: 380, viewportPx: 440, rowHeight: ROW, rowCount: 41 };
    expect(atLadderNudgeToClearSheet(12, v)).toBe(0);
    const hidden = 22;
    const nudge = atLadderNudgeToClearSheet(hidden, v);
    expect(nudge).toBe((hidden + 1) * ROW - 380 - (440 - 6));
    expect(atLadderNudgeToClearSheet(hidden, { ...v, scrollTop: v.scrollTop + nudge })).toBe(0);
  });

  it("holds the strikes on screen when a page lands above or the window moves", () => {
    const base = [7340, 7335, 7330, 7325];
    expect(atLadderScrollShiftForRows(base, [7350, 7345, ...base], ROW)).toBe(2 * ROW);
    expect(atLadderScrollShiftForRows(base, [...base, 7320, 7315], ROW)).toBe(0);
    expect(atLadderScrollShiftForRows(base, [7330, 7325, 7320], ROW)).toBe(-2 * ROW);
    expect(atLadderScrollShiftForRows(base, [6000, 5995], ROW)).toBe(0);
    expect(atLadderScrollShiftForRows([], base, ROW)).toBe(0);
  });
});
