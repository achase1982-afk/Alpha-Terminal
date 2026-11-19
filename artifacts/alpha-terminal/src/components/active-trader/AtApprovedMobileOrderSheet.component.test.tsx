/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { StrategyLeg } from "@/components/StrategyBuilder";
import {
  AtApprovedMobileOrderSheet,
  type AtApprovedMobileOrderSheetProps,
} from "./AtApprovedMobileOrderSheet";

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}
(window as unknown as { PointerEvent: typeof TestPointerEvent }).PointerEvent = TestPointerEvent;

const leg = (id: string, strike: number, optionType: "CALL" | "PUT", direction: StrategyLeg["direction"]): StrategyLeg =>
  ({
    id,
    optionType,
    direction,
    strike,
    expiration: "2026-11-18",
    quantity: 1,
    bid: 1,
    ask: 1.1,
    schwabSymbol: `SPXW  261118${optionType[0]}${String(strike * 1000).padStart(8, "0")}`,
  }) as StrategyLeg;

const LEGS = [
  leg("a", 7330, "CALL", "SELL_TO_OPEN"),
  leg("b", 7340, "CALL", "BUY_TO_OPEN"),
  leg("c", 7310, "PUT", "SELL_TO_OPEN"),
  leg("d", 7300, "PUT", "BUY_TO_OPEN"),
];

function renderSheet(over: Partial<AtApprovedMobileOrderSheetProps> = {}) {
  const onCollapsedChange = vi.fn();
  const props: AtApprovedMobileOrderSheetProps = {
    legs: LEGS,
    collapsed: false,
    sheetPeek: false,
    docked: true,
    onCollapsedChange,
    onClearAll: vi.fn(),
    onRemoveLeg: vi.fn(),
    entryLabel: "Entry credit",
    entryAmount: 440,
    targetExitAmount: 415,
    estNetAmount: 19.64,
    maxLossLabel: "$560",
    midDisplay: "4.30",
    limitPrice: "4.40",
    onLimitPriceChange: vi.fn(),
    limitLocked: false,
    onLimitLockedChange: vi.fn(),
    onNudgeLimit: vi.fn(),
    orderType: "LIMIT",
    onOrderTypeChange: vi.fn(),
    limitTickCtx: { underlyingSymbol: "$SPX", isOption: true },
    sendLabel: "Send to Schwab",
    sendDisabled: false,
    onSend: vi.fn(),
    ...over,
  };
  const view = render(<AtApprovedMobileOrderSheet {...props} />);
  const handle = view.container.querySelector<HTMLButtonElement>("[data-at-order-sheet-handle]")!;
  return { view, handle, onCollapsedChange, props };
}

const at = (y: number) => ({ pointerId: 3, clientX: 200, clientY: y, bubbles: true });

describe("Active Trader order sheet handle", () => {
  afterEach(cleanup);

  it("shows the full ticket with a grab handle", () => {
    const { view, handle } = renderSheet();
    expect(handle.getAttribute("aria-expanded")).toBe("true");
    expect(view.getByText("Send to Schwab")).toBeTruthy();
    expect(view.container.querySelectorAll("[data-at-ticket-legs] > div")).toHaveLength(4);
  });

  it("keeps the expanded ticket open on a handle tap and collapses on a swipe down", () => {
    const { handle, onCollapsedChange } = renderSheet();
    fireEvent.pointerDown(handle, at(700));
    fireEvent.pointerUp(handle, at(702));
    expect(onCollapsedChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(handle, at(700));
    fireEvent.pointerUp(handle, at(760));
    expect(onCollapsedChange).toHaveBeenLastCalledWith(true);
  });

  it("ignores a short drag that is neither a tap nor a swipe", () => {
    const { handle, onCollapsedChange } = renderSheet();
    fireEvent.pointerDown(handle, at(700));
    fireEvent.pointerUp(handle, at(715));
    expect(onCollapsedChange).not.toHaveBeenCalled();
  });

  it("collapsed: one line with the leg count and entry, and it opens again", () => {
    const { view, handle, onCollapsedChange } = renderSheet({ collapsed: true });
    expect(view.container.querySelector("[data-at-order-sheet-collapsed]")).not.toBeNull();
    expect(view.getByText("4 legs")).toBeTruthy();
    expect(view.getByText("$440.00")).toBeTruthy();
    expect(view.queryByText("Send to Schwab")).toBeNull();

    fireEvent.pointerDown(handle, at(900));
    fireEvent.pointerUp(handle, at(900));
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);

    onCollapsedChange.mockClear();
    fireEvent.pointerDown(handle, at(900));
    fireEvent.pointerUp(handle, at(850));
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);
  });

  it("does not collapse the expanded ticket from the keyboard", () => {
    const { handle, onCollapsedChange } = renderSheet();
    fireEvent.click(handle, { detail: 0 });
    expect(onCollapsedChange).not.toHaveBeenCalled();
  });
});
