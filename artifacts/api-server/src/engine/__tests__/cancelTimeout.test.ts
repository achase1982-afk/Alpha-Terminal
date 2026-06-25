import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Config } from "../types.js";

// ── Mocks ──────────────────────────────────────────────────────────────────
// Mock the engine's heavy / side-effectful dependencies so importing index.ts
// stays cheap and deterministic. The real `state` singleton (state.js) is left
// unmocked so we can mutate it and assert on it directly.

const mocks = vi.hoisted(() => ({
  cancelOrder: vi.fn(async () => true),
  broadcastToClients: vi.fn(),
}));

const TEST_CONFIG: Config = {
  symbol: "AAPL",
  accountHash: "HASH",
  orWindowMinutes: 15,
  rvolThreshold: 1.5,
  stopMode: "or_low",
  atrK: 1.0,
  rTarget: 1.5,
  minTargetOverSpread: 3,
  dailyLossHaltPct: 0.03,
  riskPerTradePct: 0.01,
  maxPositionSizePct: 0.2,
  lossStreakLimit: 3,
  cooldownMinutes: 60,
  tradesPerDay: 3,
  enableShorts: false,
  runMode: "shadow",
  cancelTimeoutSeconds: 30,
  timeStop: "15:55",
  startingEquity: 1000,
  logDb: ":memory:",
};

vi.mock("../config.js", () => ({
  getConfig: () => TEST_CONFIG,
  loadConfig: () => TEST_CONFIG,
  configExists: () => true,
}));

vi.mock("../execution.js", () => ({
  cancelOrder: mocks.cancelOrder,
  placeBracket: vi.fn(),
  flattenPosition: vi.fn(),
}));

vi.mock("../logger.js", () => ({
  initLogger: vi.fn(),
  logSignal: vi.fn(),
  getTodayPnl: vi.fn(() => 0),
  getLossStreak: vi.fn(() => 0),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/wsServer.js", () => ({
  broadcastToClients: mocks.broadcastToClients,
}));

vi.mock("../../lib/schwabStreamer.js", () => ({
  getStrategistChartEquityBars: vi.fn(() => []),
  getQuoteBySymbol: vi.fn(() => null),
  addChartEquitySymbols: vi.fn(),
}));

import { checkCancelTimeout } from "../index.js";
import { state } from "../state.js";

describe("checkCancelTimeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Simulate the optimistic state set right after a bracket order is placed:
    // position recorded as open and the day marked as "entered", with a
    // pending entry limit that was placed longer ago than the timeout window.
    state.pendingEntryOrderId = "12345";
    state.pendingEntryAt = Date.now() - 60_000; // 60s ago > 30s timeout
    state.enteredToday = true;
    state.position = {
      symbol: "AAPL",
      quantity: 10,
      avgPrice: 100,
      stopPrice: 99,
      targetPrice: 102,
      isFlat: false,
    };
  });

  it("rolls back the optimistic position and re-arms the strategy when the entry order is cancelled", async () => {
    await checkCancelTimeout();

    expect(mocks.cancelOrder).toHaveBeenCalledWith("12345", expect.anything());
    // The entry never filled, so the phantom position must be cleared — this is
    // what prevents the 15:55 time-stop from flattening shares never bought.
    expect(state.position).toBeNull();
    // And the strategy must re-arm so it can take the next valid signal.
    expect(state.enteredToday).toBe(false);
    expect(state.pendingEntryOrderId).toBeNull();
    expect(state.pendingEntryAt).toBeNull();
  });

  it("does nothing while the entry is still within the timeout window", async () => {
    state.pendingEntryAt = Date.now(); // just placed

    await checkCancelTimeout();

    expect(mocks.cancelOrder).not.toHaveBeenCalled();
    expect(state.position).not.toBeNull();
    expect(state.enteredToday).toBe(true);
    expect(state.pendingEntryOrderId).toBe("12345");
  });

  it("does nothing when there is no pending entry order", async () => {
    state.pendingEntryOrderId = null;
    state.pendingEntryAt = null;

    await checkCancelTimeout();

    expect(mocks.cancelOrder).not.toHaveBeenCalled();
  });
});
