import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Config } from "../types.js";

const mocks = vi.hoisted(() => ({ logExit: vi.fn() }));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../logger.js", () => ({ logExit: mocks.logExit }));
vi.mock("../../lib/schwabPortfolioAccounts.js", () => ({ fetchMappedSchwabAccounts: vi.fn() }));
vi.mock("../../lib/tokenStore.js", () => ({ getTokens: vi.fn(() => null) }));

import { applyReconciliation, type BrokerPosition, type BrokerOrder } from "../reconcile.js";
import { state, newSymbolState } from "../state.js";

const CFG = { accountHash: "H", lossStreakLimit: 3, cooldownMinutes: 60, tradesPerDay: 40 } as unknown as Config;

function seedSymbol(sym: string) {
  const s = newSymbolState(sym);
  state.symbols.set(sym, s);
  return s;
}

function posMap(...ps: BrokerPosition[]): Map<string, BrokerPosition> {
  return new Map(ps.map((p) => [p.symbol, p]));
}
function orderMap(...os: BrokerOrder[]): Map<string, BrokerOrder> {
  return new Map(os.map((o) => [o.orderId, o]));
}

describe("applyReconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.symbols.clear();
    state.riskState = { halted: false, dailyLossHalt: false, lossStreak: 0, tradesToday: 0, symbolsTradedToday: [] };
  });

  it("corrects a partial fill (broker holds fewer shares than ordered)", () => {
    const s = seedSymbol("AAPL");
    s.position = { symbol: "AAPL", quantity: 100, avgPrice: 100, stopPrice: 99, targetPrice: 102, isFlat: false };

    const corr = applyReconciliation(posMap({ symbol: "AAPL", quantity: 60, avgPrice: 100 }), orderMap(), CFG);

    expect(s.position!.quantity).toBe(60);
    expect(corr.join(" ")).toMatch(/quantity mismatch/i);
  });

  it("records an exit when the broker is flat but the engine still holds", () => {
    const s = seedSymbol("AAPL");
    s.position = { symbol: "AAPL", quantity: 100, avgPrice: 100, stopPrice: 99, targetPrice: 102, isFlat: false };
    s.features.last = 101;

    const corr = applyReconciliation(posMap(), orderMap(), CFG);

    expect(s.position).toBeNull();
    expect(mocks.logExit).toHaveBeenCalledTimes(1);
    expect(mocks.logExit.mock.calls[0]![0]).toMatchObject({ exitReason: "RECONCILED", pnl: 100 });
    expect(state.riskState.tradesToday).toBe(1);
    expect(corr.join(" ")).toMatch(/broker flat/i);
  });

  it("clears the optimistic position when the pending entry was rejected", () => {
    const s = seedSymbol("AAPL");
    s.pendingEntryOrderId = "999";
    s.pendingEntryAt = Date.now();
    s.position = { symbol: "AAPL", quantity: 10, avgPrice: 100, stopPrice: 99, targetPrice: 102, isFlat: false };

    const corr = applyReconciliation(
      posMap(),
      orderMap({ orderId: "999", symbol: "AAPL", status: "REJECTED", filledQuantity: 0 }),
      CFG,
    );

    expect(s.position).toBeNull();
    expect(s.pendingEntryOrderId).toBeNull();
    expect(corr.join(" ")).toMatch(/REJECTED/);
  });

  it("adopts a broker position the engine doesn't know about", () => {
    const s = seedSymbol("AAPL");
    expect(s.position).toBeNull();

    applyReconciliation(posMap({ symbol: "AAPL", quantity: 25, avgPrice: 50.5 }), orderMap(), CFG);

    expect(s.position).toMatchObject({ symbol: "AAPL", quantity: 25, avgPrice: 50.5, isFlat: false });
  });

  it("corrects a diverging average cost", () => {
    const s = seedSymbol("AAPL");
    s.position = { symbol: "AAPL", quantity: 10, avgPrice: 100, stopPrice: 99, targetPrice: 102, isFlat: false };

    applyReconciliation(posMap({ symbol: "AAPL", quantity: 10, avgPrice: 100.37 }), orderMap(), CFG);

    expect(s.position!.avgPrice).toBeCloseTo(100.37, 5);
  });

  it("leaves state untouched when engine and broker agree", () => {
    const s = seedSymbol("AAPL");
    s.position = { symbol: "AAPL", quantity: 10, avgPrice: 100, stopPrice: 99, targetPrice: 102, isFlat: false };

    const corr = applyReconciliation(posMap({ symbol: "AAPL", quantity: 10, avgPrice: 100 }), orderMap(), CFG);

    expect(corr).toHaveLength(0);
    expect(s.position!.quantity).toBe(10);
    expect(mocks.logExit).not.toHaveBeenCalled();
  });
});
