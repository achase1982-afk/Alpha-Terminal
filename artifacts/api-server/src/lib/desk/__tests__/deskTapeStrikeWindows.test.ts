import { describe, expect, it } from "vitest";
import {
  deskStrikeWindowForExpiry,
  filterDeskChainByStrikeWindow,
  trimDeskOptionsToBudget,
  type DeskOptionPick,
} from "../deskTapeStrikeWindows.js";
import type { DeskChainNormalized } from "../deskSchwabChains.js";

function c(symbol: string, strike: number, expiration: string): DeskChainNormalized {
  return {
    symbol,
    strike,
    expiration,
    call_put: "call",
    bid: null,
    ask: null,
    last: null,
    mark: null,
    volume: null,
    open_interest: null,
    vendor_iv: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    rho: null,
    quote_ts: null,
    trade_ts: null,
    mid: null,
    spread: null,
    spread_pct: null,
  };
}

describe("deskTapeStrikeWindows", () => {
  it("uses all strikes for 0DTE", () => {
    const w = deskStrikeWindowForExpiry("2026-11-17", [], "2026-11-17");
    expect(w.kind).toBe("all");
  });

  it("uses monthly band when SPX monthlies present", () => {
    const rows = [c("SPX   261120C07500000", 7500, "2026-11-20")];
    const w = deskStrikeWindowForExpiry("2026-11-20", rows, "2026-11-17");
    expect(w).toEqual({ kind: "range", minStrike: 6965, maxStrike: 7835 });
    const f = filterDeskChainByStrikeWindow(
      [c("SPXW  261120C05000000", 5000, "2026-11-20"), c("SPX   261120C07500000", 7500, "2026-11-20")],
      w,
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.strike).toBe(7500);
  });

  it("trims farthest expiries when over budget", () => {
    const picks: DeskOptionPick[] = [
      { expiry: "2026-11-17", symbol: "a", strike: 7400 },
      { expiry: "2026-11-18", symbol: "b", strike: 7400 },
      { expiry: "2026-11-23", symbol: "c", strike: 7400 },
    ];
    const r = trimDeskOptionsToBudget(picks, 2, 7400);
    expect(r.symbols).toEqual(["a", "b"]);
    expect(r.capReason).toContain("budget_2");
  });
});