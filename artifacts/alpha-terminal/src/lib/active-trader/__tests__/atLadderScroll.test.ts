/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  atLadderNudgeToClearSheet,
  atLadderRowFullyVisible,
  atLadderRowOffsetFromBand,
  atLadderScrollShiftForRows,
  atLadderScrollTopForRow,
  atLadderVisibleRowRange,
  chainAtmRowOffCenter,
  resolveChainAtmRow,
  scrollChainViewportToAtm,
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

  it("puts the spot row on the band, flush to a row edge, and clamps at the ends", () => {
    const v = { viewportPx: 648, rowHeight: ROW, rowCount: 41 };
    const top = atLadderScrollTopForRow(20, v);
    expect(top % ROW).toBe(0);
    // Within half a row of the band, and fully on screen.
    expect(Math.abs(atLadderRowOffsetFromBand(20, { ...v, scrollTop: top }))).toBeLessThanOrEqual(ROW / 2);
    expect(atLadderRowFullyVisible(20, { ...v, scrollTop: top })).toBe(true);
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

describe("options chain ATM recenter", () => {
  it("prefers the marked spot strike rail over nearest strike by price", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div data-chain-strike="4999" data-chain-strike-rail style="height:38px"></div>
      <div data-chain-strike="5000" data-chain-strike-rail style="height:38px">
        <span data-chain-spot-strike="1"></span>
      </div>
      <div data-chain-strike="5001" data-chain-strike-rail style="height:38px"></div>
    `;
    const row = resolveChainAtmRow(container, 5000.25);
    expect(row?.getAttribute("data-chain-strike")).toBe("5000");
    expect(row?.hasAttribute("data-chain-strike-rail")).toBe(true);
  });

  it("falls back to nearest data-chain-strike when spot marker is absent", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div data-chain-strike="100" style="height:38px"></div>
      <div data-chain-strike="105" style="height:38px"></div>
    `;
    expect(resolveChainAtmRow(container, 104)?.getAttribute("data-chain-strike")).toBe("105");
  });

  it("scrolls the ATM row to the viewport center", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
    let scrollTop = 0;
    Object.defineProperty(container, "scrollTop", {
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
      configurable: true,
    });
    Object.defineProperty(container, "scrollHeight", { value: 4000, configurable: true });
    container.getBoundingClientRect = () =>
      ({ top: 0, left: 0, width: 320, height: 400, bottom: 400, right: 320, x: 0, y: 0, toJSON: () => ({}) });
    const atm = document.createElement("div");
    atm.setAttribute("data-chain-strike", "5000");
    atm.setAttribute("data-chain-strike-rail", "");
    Object.defineProperty(atm, "offsetHeight", { value: 38, configurable: true });
    atm.getBoundingClientRect = () =>
      ({ top: 800, left: 0, width: 80, height: 38, bottom: 838, right: 80, x: 0, y: 800, toJSON: () => ({}) });
    const spot = document.createElement("span");
    spot.setAttribute("data-chain-spot-strike", "1");
    atm.appendChild(spot);
    container.appendChild(atm);
    scrollChainViewportToAtm(container, 5000, 0, "auto");
    // Row center is 819px; the 400px pane centers it at 200, so scroll by 619.
    expect(scrollTop).toBe(619);
  });

  it("pads above a short book so spot can sit on the center line", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
    let scrollTop = 0;
    Object.defineProperty(container, "scrollTop", {
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
      configurable: true,
    });
    Object.defineProperty(container, "scrollHeight", { value: 280, configurable: true });
    container.getBoundingClientRect = () =>
      ({ top: 0, left: 0, width: 320, height: 400, bottom: 400, right: 320, x: 0, y: 0, toJSON: () => ({}) });
    const topSpacer = document.createElement("div");
    topSpacer.setAttribute("data-chain-center-spacer", "top");
    const bottomSpacer = document.createElement("div");
    bottomSpacer.setAttribute("data-chain-center-spacer", "bottom");
    const atm = document.createElement("div");
    atm.setAttribute("data-chain-strike", "100");
    atm.setAttribute("data-chain-strike-rail", "");
    atm.getBoundingClientRect = () =>
      ({ top: 40, left: 0, width: 80, height: 38, bottom: 78, right: 80, x: 0, y: 40, toJSON: () => ({}) });
    const spot = document.createElement("span");
    spot.setAttribute("data-chain-spot-strike", "1");
    atm.appendChild(spot);
    container.append(topSpacer, atm, bottomSpacer);
    scrollChainViewportToAtm(container, 100, 0, "auto");
    expect(scrollTop).toBe(0);
    expect(topSpacer.style.height).toBe("141px");
    expect(bottomSpacer.style.height).toBe("0px");
  });

  it("centers the spot row in the body under the sticky chain header", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
    let scrollTop = 0;
    Object.defineProperty(container, "scrollTop", {
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
      configurable: true,
    });
    Object.defineProperty(container, "scrollHeight", { value: 4000, configurable: true });
    container.getBoundingClientRect = () =>
      ({ top: 0, left: 0, width: 320, height: 400, bottom: 400, right: 320, x: 0, y: 0, toJSON: () => ({}) });
    const header = document.createElement("div");
    header.setAttribute("data-chain-sticky-bar", "");
    Object.defineProperty(header, "offsetHeight", { value: 80 });
    const atm = document.createElement("div");
    atm.setAttribute("data-chain-strike", "5000");
    atm.setAttribute("data-chain-strike-rail", "");
    atm.getBoundingClientRect = () =>
      ({ top: 284, left: 0, width: 80, height: 32, bottom: 316, right: 80, x: 0, y: 284, toJSON: () => ({}) });
    const spot = document.createElement("span");
    spot.setAttribute("data-chain-spot-strike", "1");
    atm.appendChild(spot);
    container.append(header, atm);
    // Row center is 300. Under an 80px header the body center is 240 (60px away).
    // The full pane center is 200 (100px away), which would still count as off.
    expect(chainAtmRowOffCenter(container, 5000, 70, 0)).toBe(false);
    scrollChainViewportToAtm(container, 5000, 0, "auto");
    expect(scrollTop).toBe(60);
  });
});
