/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { OptionsContract } from "@/components/OptionsTab";
import { GOLD } from "@/components/options/optionsTheme";
import { useOptionsStreamStore, type OptionTick } from "@/lib/options-stream-store";
import { createAtLadderHeatStore, publishAtLadderHeat } from "@/lib/active-trader/atLadderHeatStore";
import {
  atSelectionToggleLeg,
  createAtLadderSelectionStore,
} from "@/lib/active-trader/atLadderSelection";
import {
  LadderBody,
  type AtLadderRenderProbe,
  type LadderRowModel,
} from "./LadderBody";

/** 14:30 ET on a trading day: the ladder only arms quote cells during the options session. */
const NOW = Date.parse("2026-11-18T19:30:00.000Z");
const EXPIRATION = "2026-11-18T21:00:00.000+00:00";
const SPOT = 7321.4;

function contract(strike: number, type: "C" | "P"): OptionsContract {
  const mid = Math.max(0.1, type === "C" ? 30 - (strike - 7300) / 2 : 30 + (strike - 7340) / 2);
  return {
    strike,
    expiration: EXPIRATION,
    streamKey: `SPXW  261118${type}${String(strike * 1000).padStart(8, "0")}`,
    bid: Number(mid.toFixed(2)),
    ask: Number((mid + 0.1).toFixed(2)),
    quoteTimeMs: NOW - 500,
    volume: 1000,
    openInterest: 500,
  } as OptionsContract;
}

function buildRows(): LadderRowModel[] {
  const rows: LadderRowModel[] = [];
  for (let strike = 7420; strike >= 7220; strike -= 5) {
    rows.push({ strike, call: contract(strike, "C"), put: contract(strike, "P") });
  }
  return rows;
}

function tick(c: OptionsContract, over: Partial<OptionTick>): OptionTick {
  return {
    key: c.streamKey!,
    bid: c.bid ?? null,
    ask: c.ask ?? null,
    last: null,
    bidSize: 10,
    askSize: 10,
    volume: 1000,
    openInterest: 500,
    iv: 20,
    delta: 0.5,
    gamma: 0.01,
    theta: -1,
    vega: 0.1,
    mark: null,
    change: 0,
    lastSize: 1,
    underlyingPrice: SPOT,
    quoteTime: NOW,
    tradeTime: NOW - 1000,
    volumeSample: null,
    ts: NOW,
    ...over,
  };
}

/** jsdom has no PointerEvent; without one, fireEvent.pointer* sends a bare Event with no coordinates. */
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly isPrimary: boolean;
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.isPrimary = init.isPrimary ?? true;
    this.pointerType = init.pointerType ?? "mouse";
  }
}
(window as unknown as { PointerEvent: typeof TestPointerEvent }).PointerEvent = TestPointerEvent;

const counts = { body: 0, row: 0, pair: 0, cell: 0 };
const resetCounts = () => {
  counts.body = 0;
  counts.row = 0;
  counts.pair = 0;
  counts.cell = 0;
};

function setup(over: { onQuoteTap?: ReturnType<typeof vi.fn>; inScroller?: boolean } = {}) {
  const rows = buildRows();
  const heat = createAtLadderHeatStore();
  const selection = createAtLadderSelectionStore();
  const onQuoteTap = over.onQuoteTap ?? vi.fn();
  const rowByStrike = new Map(rows.map((r) => [r.strike, r]));
  const positionQtyByKey = new Map<string, number>();
  const onVerticalTap = vi.fn();
  const ladder = (
    <LadderBody
      rows={rows}
      accentHex={GOLD}
      spotStrike={7320}
      flip={7295}
      callWall={7350}
      putWall={7300}
      pinStrike={null}
      wallsRolling={false}
      selectedStrike={null}
      onQuoteTap={onQuoteTap}
      positionQtyByKey={positionQtyByKey}
      heat={heat}
      selection={selection}
      ladderMode="single"
      verticalWidth={5}
      rowByStrike={rowByStrike}
      onVerticalTap={onVerticalTap}
      chainQuoteTs={NOW - 1000}
      expiryLabel="18 Nov 26"
    />
  );
  const view = render(over.inScroller ? <div data-at-ladder-scroll>{ladder}</div> : ladder);
  const cell = (id: string) => view.container.querySelector<HTMLButtonElement>(`[data-at-quote="${id}"]`)!;
  resetCounts();
  return { rows, heat, selection, onQuoteTap, cell, view };
}

const pointer = (x: number, y: number) => ({
  pointerId: 7,
  isPrimary: true,
  pointerType: "touch",
  button: 0,
  clientX: x,
  clientY: y,
  bubbles: true,
});

describe("LadderBody", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    useOptionsStreamStore.getState().clearTicks();
    (globalThis as { __AT_LADDER_RENDER_PROBE__?: AtLadderRenderProbe }).__AT_LADDER_RENDER_PROBE__ = (part) => {
      counts[part] += 1;
    };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete (globalThis as { __AT_LADDER_RENDER_PROBE__?: AtLadderRenderProbe }).__AT_LADDER_RENDER_PROBE__;
  });

  it("renders every strike, high strikes on top, with live tappable quote cells", () => {
    const { view, cell } = setup();
    const strikes = [...view.container.querySelectorAll("[data-at-ladder-row]")].map((el) =>
      Number(el.getAttribute("data-at-ladder-row")),
    );
    expect(strikes).toHaveLength(41);
    expect(strikes[0]).toBe(7420);
    expect(strikes[40]).toBe(7220);
    expect(cell("call-ask-7330").disabled).toBe(false);
    expect(cell("call-ask-7330").dataset.atTapable).toBe("1");
    expect(view.container.querySelector('[data-at-spot-row="1"]')?.getAttribute("data-at-ladder-row")).toBe("7320");
    expect(view.container.querySelector('[data-at-gamma-flip-row="1"]')?.getAttribute("data-at-ladder-row")).toBe("7295");
    const flipTag = view.container.querySelector<HTMLElement>("[data-at-strike-gamma-flip]")!;
    expect(flipTag.textContent).toBe("GAMMAFLIP");
    expect(flipTag.style.fontSize).toBe("7px");
    expect(flipTag.style.border).toBe("");
    expect(flipTag.style.left).toBe("0px");
  });

  it("a quote re-renders its own contract and nothing else", () => {
    const { rows, cell } = setup();
    const target = rows.find((r) => r.strike === 7330)!.call!;
    act(() => {
      useOptionsStreamStore.getState().mergeTicks([tick(target, { bid: 2.35, ask: target.ask! })]);
    });
    expect(cell("call-bid-7330").textContent).toBe("2.35");
    expect(counts).toEqual({ body: 0, row: 0, pair: 1, cell: 1 });
  });

  it("ticks that move only sizes, greeks or timestamps re-render nothing", () => {
    const { rows } = setup();
    const batch = rows.flatMap((r) => [
      tick(r.call!, { bidSize: 99, delta: 0.42, ts: NOW + 5, quoteTime: NOW + 5 }),
      tick(r.put!, { askSize: 77, gamma: 0.02, ts: NOW + 5, quoteTime: NOW + 5 }),
    ]);
    act(() => {
      useOptionsStreamStore.getState().mergeTicks(batch);
    });
    expect(counts).toEqual({ body: 0, row: 0, pair: 0, cell: 0 });
  });

  it("200 quotes a second across the ladder never re-render a row or the ladder", () => {
    const { rows } = setup();
    const contracts = rows.flatMap((r) => [r.call!, r.put!]);
    const frames = 60;
    let sent = 0;
    for (let f = 0; f < frames; f++) {
      const batch: OptionTick[] = [];
      const due = Math.round(((f + 1) * 200) / frames) - sent;
      for (let i = 0; i < due; i++) {
        const c = contracts[sent % contracts.length]!;
        const bid = Number(((c.bid ?? 1) + ((sent % 7) + 1) * 0.05).toFixed(2));
        batch.push(tick(c, { bid, ask: Number((bid + 0.1).toFixed(2)), ts: NOW + sent }));
        sent += 1;
      }
      act(() => {
        useOptionsStreamStore.getState().mergeTicks(batch);
      });
    }
    expect(sent).toBe(200);
    expect(counts.body).toBe(0);
    expect(counts.row).toBe(0);
    expect(counts.pair).toBeLessThanOrEqual(200);
    expect(counts.pair).toBeGreaterThan(0);
  });

  it("a heat repaint re-renders only the contracts whose shade moved", () => {
    const { rows, heat, view } = setup();
    const hot = rows.find((r) => r.strike === 7325)!.call!;
    act(() => {
      publishAtLadderHeat(heat, { [hot.streamKey!]: { availability: "live", contracts30s: 900, intensity: 0.8 } });
    });
    expect(counts).toEqual({ body: 0, row: 0, pair: 1, cell: 0 });
    const pair = view.container.querySelector('[data-at-ladder-row="7325"] [data-at-quote-heat="call"]')!;
    expect(pair.getAttribute("data-at-quote-heat-intensity")).toBe("0.800");
    expect(pair.getAttribute("data-at-quote-heat-contracts")).toBe("900");
  });

  it("highlights the touched cell at once and commits the leg on lift", () => {
    const { cell, onQuoteTap, rows } = setup();
    const target = cell("call-ask-7330");

    const startedAt = performance.now();
    fireEvent.pointerDown(target, pointer(100, 200));
    const highlightMs = performance.now() - startedAt;
    expect(target.hasAttribute("data-at-pressed")).toBe(true);
    expect(highlightMs).toBeLessThan(100);
    expect(onQuoteTap).not.toHaveBeenCalled();
    expect(counts).toEqual({ body: 0, row: 0, pair: 0, cell: 1 });

    fireEvent.pointerUp(target, pointer(101, 201));
    expect(target.hasAttribute("data-at-pressed")).toBe(false);
    expect(onQuoteTap).toHaveBeenCalledTimes(1);
    expect(onQuoteTap).toHaveBeenCalledWith(rows.find((r) => r.strike === 7330)!.call, "CALL", "BUY");

    // The browser's follow-up click for the same tap must not toggle the leg back.
    fireEvent.click(target);
    expect(onQuoteTap).toHaveBeenCalledTimes(1);
    expect(counts.row).toBe(0);
    expect(counts.body).toBe(0);
  });

  it("stays instant while quotes are streaming", () => {
    const { cell, rows } = setup();
    const contracts = rows.flatMap((r) => [r.call!, r.put!]);
    const target = cell("put-bid-7310");
    let worst = 0;
    for (let f = 0; f < 30; f++) {
      const batch = contracts
        .slice((f * 4) % contracts.length, ((f * 4) % contracts.length) + 4)
        .map((c, i) => tick(c, { bid: Number(((c.bid ?? 1) + 0.05 * ((f + i) % 5)).toFixed(2)), ts: NOW + f }));
      act(() => {
        useOptionsStreamStore.getState().mergeTicks(batch);
      });
      const startedAt = performance.now();
      fireEvent.pointerDown(target, pointer(300, 400));
      const pressed = target.hasAttribute("data-at-pressed");
      worst = Math.max(worst, performance.now() - startedAt);
      expect(pressed).toBe(true);
      fireEvent.pointerCancel(target, pointer(300, 400));
      expect(target.hasAttribute("data-at-pressed")).toBe(false);
    }
    expect(worst).toBeLessThan(100);
  });

  it("drops the press when the finger drags past the slop (a scroll)", () => {
    const { cell, onQuoteTap } = setup();
    const target = cell("call-bid-7335");
    fireEvent.pointerDown(target, pointer(100, 200));
    fireEvent.pointerMove(target, pointer(102, 205));
    expect(target.hasAttribute("data-at-pressed")).toBe(true);
    fireEvent.pointerMove(target, pointer(102, 209));
    expect(target.hasAttribute("data-at-pressed")).toBe(false);
    fireEvent.pointerUp(target, pointer(102, 240));
    expect(onQuoteTap).not.toHaveBeenCalled();
  });

  it("drops the press when the browser takes the touch for scrolling", () => {
    const { cell, onQuoteTap } = setup();
    const target = cell("put-ask-7300");
    fireEvent.pointerDown(target, pointer(100, 200));
    fireEvent.pointerCancel(target, pointer(100, 230));
    expect(target.hasAttribute("data-at-pressed")).toBe(false);
    fireEvent.pointerUp(target, pointer(100, 230));
    expect(onQuoteTap).not.toHaveBeenCalled();
  });

  it("a touch while the ladder is still moving stops the scroll and picks nothing", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(10_000);
    try {
      const { cell, onQuoteTap, view } = setup({ inScroller: true });
      const scroller = view.container.querySelector("[data-at-ladder-scroll]")!;
      const target = cell("call-ask-7330");

      fireEvent.scroll(scroller);
      now.mockReturnValue(10_060);
      fireEvent.pointerDown(target, pointer(100, 200));
      expect(target.hasAttribute("data-at-pressed")).toBe(false);
      fireEvent.pointerUp(target, pointer(100, 200));
      expect(onQuoteTap).not.toHaveBeenCalled();

      now.mockReturnValue(10_250);
      fireEvent.pointerDown(target, pointer(100, 200));
      expect(target.hasAttribute("data-at-pressed")).toBe(true);
      fireEvent.pointerUp(target, pointer(100, 200));
      expect(onQuoteTap).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  it("drops a held press when the ladder scrolls under the finger", () => {
    const { cell, onQuoteTap, view } = setup({ inScroller: true });
    const scroller = view.container.querySelector("[data-at-ladder-scroll]")!;
    const target = cell("put-bid-7310");
    fireEvent.pointerDown(target, pointer(100, 200));
    expect(target.hasAttribute("data-at-pressed")).toBe(true);
    fireEvent.scroll(scroller);
    expect(target.hasAttribute("data-at-pressed")).toBe(false);
    fireEvent.pointerUp(target, pointer(100, 200));
    expect(onQuoteTap).not.toHaveBeenCalled();
  });

  it("draws prices regular and strikes semibold at mockup sizes, with fixed-width figures", () => {
    const { cell, view } = setup();
    expect(view.container.querySelector("[data-at-ladder-body]")!.classList.contains("at-ladder-num")).toBe(true);
    expect(cell("call-bid-7330").style.fontWeight).toBe("400");
    expect(cell("call-bid-7330").style.fontVariantNumeric).toBe("tabular-nums");
    expect(cell("call-bid-7330").style.fontSize).toBe("16px");
    const strike = view.container.querySelector<HTMLElement>('[data-at-strike="7330"] > div')!;
    expect(strike.style.fontWeight).toBe("400");
    expect(strike.style.fontSize).toBe("18px");
    const spotCell = view.container.querySelector<HTMLElement>('[data-at-strike="7320"]')!;
    expect(spotCell.style.background).toMatch(/rgb\(251,\s*191,\s*36\)|#fbbf24/i);
    const spot = spotCell.querySelector<HTMLElement>("div")!;
    expect(spot.style.background).toBe("transparent");
    expect(spot.style.fontWeight).toBe("500");
  });

  it("outlines the call wall in gold and the put wall in teal", () => {
    const { view } = setup();
    const callRow = view.container.querySelector<HTMLElement>('[data-at-call-wall-row="1"]')!;
    const putRow = view.container.querySelector<HTMLElement>('[data-at-put-wall-row="1"]')!;
    expect(callRow.getAttribute("data-at-ladder-row")).toBe("7350");
    expect(putRow.getAttribute("data-at-ladder-row")).toBe("7300");
    expect(callRow.querySelector("[data-at-call-wall-outline]")?.getAttribute("style")).toMatch(/rgb\(251,\s*191,\s*36\)/);
    expect(putRow.querySelector("[data-at-put-wall-outline]")?.getAttribute("style")).toMatch(/rgb\(20,\s*184,\s*166\)/);
    expect(callRow.querySelector("[data-at-strike-call-wall]")?.textContent).toBe("CALLWALL");
    expect(putRow.querySelector("[data-at-strike-put-wall]")?.textContent).toBe("PUTWALL");
    expect(callRow.querySelector("[data-at-strike-call-wall]")?.getAttribute("style")).not.toMatch(/border/);
  });

  it("draws a thin outline + BUY/SELL tag on a selected cell with no fill wash", () => {
    const { cell, selection, rows } = setup();
    const c = rows.find((r) => r.strike === 7330)!.call!;
    act(() => {
      atSelectionToggleLeg(selection, c, "CALL", "ask");
    });
    const chip = cell("call-ask-7330").querySelector<HTMLElement>('[data-at-selected-leg-chip="BUY"]')!;
    expect(chip).not.toBeNull();
    expect(chip.style.border).toContain("1px solid");
    expect(chip.style.background).toBe("transparent");
    expect(chip.style.borderRadius).toBe("5px");
    expect(chip.textContent).toContain("BUY");
    expect(cell("call-ask-7330").style.fontSize).toBe("16px");
  });

  it("leaves quiet pairs uncolored and scales live volume heat", () => {
    const { rows, heat, view } = setup();
    const pair = (strike: number, side: "call" | "put") =>
      view.container.querySelector<HTMLElement>(`[data-at-ladder-row="${strike}"] [data-at-quote-heat="${side}"]`)!;
    expect(pair(7400, "call").style.backgroundColor).toBe("transparent");
    expect(pair(7400, "put").style.backgroundColor).toBe("transparent");
    expect(pair(7400, "call").style.backgroundImage).toBe("none");
    expect(pair(7400, "put").style.backgroundImage).toBe("none");
    expect(pair(7400, "call").getAttribute("data-at-quote-volume")).toBe("—");

    const hot = rows.find((r) => r.strike === 7325)!.call!;
    const warm = rows.find((r) => r.strike === 7335)!.put!;
    act(() => {
      publishAtLadderHeat(heat, {
        [hot.streamKey!]: { availability: "live", contracts30s: 1138, intensity: 1 },
        [warm.streamKey!]: { availability: "live", contracts30s: 115, intensity: 0.5 },
      });
    });
    expect(pair(7325, "call").style.backgroundColor).toBe("rgb(36, 88, 117)");
    expect(pair(7325, "call").style.animation).toBe("none");
    expect(pair(7325, "call").getAttribute("data-at-quote-volume")).toBe("1138 contracts / 30s");
    expect(pair(7335, "put").style.backgroundColor).toBe("rgb(23, 57, 79)");
    expect(pair(7335, "put").style.animation).toBe("none");
    expect(pair(7335, "put").getAttribute("data-at-quote-volume")).toBe("115 contracts / 30s");
    expect(pair(7400, "call").style.animation).toBe("none");
  });

  it("commits keyboard and assistive-tech activation, which arrives as a bare click", () => {
    const { cell, onQuoteTap, rows } = setup();
    fireEvent.click(cell("put-bid-7310"));
    expect(onQuoteTap).toHaveBeenCalledWith(rows.find((r) => r.strike === 7310)!.put, "PUT", "SELL");
  });

  it("outlines a picked leg by re-rendering that one cell", () => {
    const { cell, selection, rows } = setup();
    const c = rows.find((r) => r.strike === 7330)!.call!;
    act(() => {
      atSelectionToggleLeg(selection, c, "CALL", "bid");
    });
    expect(cell("call-bid-7330").querySelector('[data-at-selected-leg-chip="SELL"]')).not.toBeNull();
    expect(cell("call-ask-7330").querySelector("[data-at-selected-leg-chip]")).toBeNull();
    expect(counts).toEqual({ body: 0, row: 0, pair: 0, cell: 1 });

    resetCounts();
    act(() => {
      atSelectionToggleLeg(selection, c, "CALL", "ask");
    });
    expect(cell("call-bid-7330").querySelector("[data-at-selected-leg-chip]")).toBeNull();
    expect(cell("call-ask-7330").querySelector('[data-at-selected-leg-chip="BUY"]')).not.toBeNull();
    expect(counts).toEqual({ body: 0, row: 0, pair: 0, cell: 2 });
  });

  it("does not arm a cell without a two-sided quote", () => {
    const rows = buildRows();
    rows[0] = { ...rows[0]!, call: { ...rows[0]!.call!, bid: undefined, ask: undefined } as OptionsContract };
    const heat = createAtLadderHeatStore();
    const selection = createAtLadderSelectionStore();
    const onQuoteTap = vi.fn();
    const view = render(
      <LadderBody
        rows={rows}
        accentHex={GOLD}
        spotStrike={7320}
        flip={null}
        callWall={null}
        putWall={null}
        pinStrike={null}
        wallsRolling={false}
        selectedStrike={null}
        onQuoteTap={onQuoteTap}
        positionQtyByKey={new Map()}
        heat={heat}
        selection={selection}
        ladderMode="single"
        verticalWidth={5}
        rowByStrike={new Map(rows.map((r) => [r.strike, r]))}
        onVerticalTap={vi.fn()}
        chainQuoteTs={NOW - 1000}
        expiryLabel="18 Nov 26"
      />,
    );
    const dead = view.container.querySelector<HTMLButtonElement>('[data-at-quote="call-ask-7420"]')!;
    expect(dead.disabled).toBe(true);
    fireEvent.pointerDown(dead, pointer(10, 10));
    fireEvent.pointerUp(dead, pointer(10, 10));
    expect(dead.hasAttribute("data-at-pressed")).toBe(false);
    expect(onQuoteTap).not.toHaveBeenCalled();
  });
});
