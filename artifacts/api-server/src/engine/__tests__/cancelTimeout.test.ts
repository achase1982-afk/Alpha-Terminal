import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Config } from "../types.js";

// ── Mocks ──────────────────────────────────────────────────────────────────
// Mock the engine's heavy / side-effectful dependencies so importing index.ts
// stays cheap and deterministic.

const mocks = vi.hoisted(() => ({
  cancelOrder: vi.fn(async () => true),
  broadcastToClients: vi.fn(),
}));

const TEST_CONFIG: Config = {
  symbol: "AAPL",
  symbols: ["AAPL"],
  accountHash: "HASH",
  setup: "swing",
  orWindowMinutes: 15,
  rvolThreshold: 1.5,
  stopMode: "or_low",
  atrK: 1.0,
  rTarget: 1.5,
  minTargetOverSpread: 3,
  bodyAvgWindow: 10,
  volAvgWindow: 20,
  directionLookback: 5,
  vwapBandAtrMult: 2.0,
  belowVwapStretchThreshold: 0.6,
  volDryingThreshold: 1.0,
  rsiEntryMin: 25,
  rsiEntryMax: 55,
  swingTargetRail: "vwap",
  stopBelowRailAtrMult: 0.5,
  volumeProfileLookbackDays: 20,
  dailyLossHaltPct: 0.03,
  riskPerTradePct: 0.01,
  maxPositionSizePct: 0.2,
  lossStreakLimit: 3,
  cooldownMinutes: 60,
  tradesPerDay: 40,
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
  logExit: vi.fn(),
  logEvaluation: vi.fn(),
  getTodayPnl: vi.fn(() => 0),
  getLossStreak: vi.fn(() => 0),
}));

vi.mock("../volumeProfile.js", () => ({
  buildVolumeProfile: vi.fn(async () => new Map()),
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
import { newSymbolState, type SymbolState } from "../state.js";

describe("checkCancelTimeout", () => {
  let s: SymbolState;

  beforeEach(() => {
    vi.clearAllMocks();
    // Optimistic state set right after a bracket order is placed: position
    // recorded as open, with a pending entry limit placed past the timeout.
    s = newSymbolState("AAPL");
    s.pendingEntryOrderId = "12345";
    s.pendingEntryAt = Date.now() - 60_000; // 60s ago > 30s timeout
    s.position = {
      symbol: "AAPL",
      quantity: 10,
      avgPrice: 100,
      stopPrice: 99,
      targetPrice: 102,
      isFlat: false,
    };
  });

  it("rolls back the optimistic position when the unfilled entry is cancelled", async () => {
    await checkCancelTimeout(s, TEST_CONFIG);

    expect(mocks.cancelOrder).toHaveBeenCalledWith("12345", expect.anything());
    // The entry never filled, so the phantom position must be cleared — this is
    // what prevents the time-stop from flattening shares never bought.
    expect(s.position).toBeNull();
    expect(s.pendingEntryOrderId).toBeNull();
    expect(s.pendingEntryAt).toBeNull();
    expect(s.pendingSignal).toBeNull();
  });

  it("does nothing while the entry is still within the timeout window", async () => {
    s.pendingEntryAt = Date.now(); // just placed

    await checkCancelTimeout(s, TEST_CONFIG);

    expect(mocks.cancelOrder).not.toHaveBeenCalled();
    expect(s.position).not.toBeNull();
    expect(s.pendingEntryOrderId).toBe("12345");
  });

  it("does nothing when there is no pending entry order", async () => {
    s.pendingEntryOrderId = null;
    s.pendingEntryAt = null;

    await checkCancelTimeout(s, TEST_CONFIG);

    expect(mocks.cancelOrder).not.toHaveBeenCalled();
  });
});
