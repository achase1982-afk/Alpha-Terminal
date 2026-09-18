import { describe, expect, it, vi } from "vitest";
import type { Config } from "../types.js";

// The engine module pulls in the AI SDK, the websocket server, and the Schwab
// streamer at import time. Only the pure risk math is under test here.
vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("../../lib/chatModel.js", () => ({ resolveChatLanguageModel: vi.fn() }));
vi.mock("../../lib/wsServer.js", () => ({ broadcastToClients: vi.fn() }));
vi.mock("../../lib/autoTrade/execute.js", () => ({ logAutoTradeDecision: vi.fn() }));
vi.mock("../../lib/schwabStreamer.js", () => ({
  getStrategistChartEquityBars: vi.fn(() => []),
  getQuoteBySymbol: vi.fn(() => null),
  addChartEquitySymbols: vi.fn(),
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../execution.js", () => ({ placeEntry: vi.fn(), flattenPosition: vi.fn() }));
vi.mock("../reconcile.js", () => ({ reconcileAccount: vi.fn() }));
vi.mock("../logger.js", () => ({
  initLogger: vi.fn(), logExit: vi.fn(), getTodayPnl: vi.fn(() => 0), getLossStreak: vi.fn(() => 0),
}));
vi.mock("../volumeProfile.js", () => ({ buildVolumeProfile: vi.fn() }));
vi.mock("../config.js", () => ({ getConfig: vi.fn(), loadConfig: vi.fn(), configExists: vi.fn(() => true) }));

import {
  computeStopDistance,
  computeProtectiveStop,
  minHoldSecondsRemaining,
  reentryCooldownRemaining,
} from "../llmEngine.js";

const CFG = {
  momStopAtrMult: 1.5,
  momTrailAtrMult: 1.0,
  llmStopEnabled: true,
  llmMinStopPct: 0.005,
  llmMaxStopPct: 0.03,
  llmMinHoldSeconds: 120,
  llmReentryCooldownSeconds: 300,
} as unknown as Config;

describe("stop distance", () => {
  it("is the ATR multiple in the ordinary case", () => {
    // 1.5 × 0.40 = 0.60, inside the 0.50–3.00 band on a $100 name.
    expect(computeStopDistance(100, 0.4, CFG)).toBeCloseTo(0.6, 6);
  });

  it("never sits closer than the floor, so spread noise cannot stop a quiet name", () => {
    // 1.5 × 0.01 = 0.015 would be 1.5 cents below entry.
    expect(computeStopDistance(100, 0.01, CFG)).toBeCloseTo(0.5, 6);
  });

  it("never sits further than the ceiling, so a wild name cannot risk the book", () => {
    // 1.5 × 5 = 7.50 on a $100 name is 7.5%; the 3% cap applies.
    expect(computeStopDistance(100, 5, CFG)).toBeCloseTo(3, 6);
  });

  it("falls back to the floor when ATR is missing or nonsensical", () => {
    expect(computeStopDistance(100, 0, CFG)).toBeCloseTo(0.5, 6);
    expect(computeStopDistance(100, Number.NaN, CFG)).toBeCloseTo(0.5, 6);
  });
});

describe("protective stop placement", () => {
  it("sits a full stop-width below entry before the trade has worked", () => {
    const s = computeProtectiveStop(100, 100, 0.4, CFG);
    expect(s.stopPrice).toBeCloseTo(99.4, 6);
    expect(s.trailing).toBe(false);
  });

  it("does not tighten on a small favorable move", () => {
    // Up 0.30 against a 0.60 stop width — the trail is not armed yet.
    const s = computeProtectiveStop(100, 100.3, 0.4, CFG);
    expect(s.stopPrice).toBeCloseTo(99.4, 6);
    expect(s.trailing).toBe(false);
  });

  it("arms the trail once the trade has made one stop-width", () => {
    // Trail distance is 0.40 ATR floored at the 0.5% minimum, so 0.50.
    // High-water 101.00 − 0.50 = 100.50, above the 99.40 hard floor.
    const s = computeProtectiveStop(100, 101, 0.4, CFG);
    expect(s.trailing).toBe(true);
    expect(s.stopPrice).toBeCloseTo(100.5, 6);
  });

  it("locks in profit as the high-water mark climbs", () => {
    const s = computeProtectiveStop(100, 105, 0.4, CFG);
    expect(s.stopPrice).toBeCloseTo(104.5, 6);
    expect(s.stopPrice).toBeGreaterThan(100);
  });

  it("never gives back the hard floor", () => {
    const s = computeProtectiveStop(100, 100.6, 0.4, CFG);
    expect(s.stopPrice).toBeGreaterThanOrEqual(99.4);
  });
});

describe("minimum hold window", () => {
  const now = 1_700_000_000_000;

  it("blocks a model-initiated close immediately after entry", () => {
    expect(minHoldSecondsRemaining(now - 5_000, CFG, now)).toBe(115);
  });

  it("clears once the window elapses", () => {
    expect(minHoldSecondsRemaining(now - 200_000, CFG, now)).toBe(0);
  });

  it("does not block when there is no entry timestamp", () => {
    expect(minHoldSecondsRemaining(null, CFG, now)).toBe(0);
    expect(minHoldSecondsRemaining(undefined, CFG, now)).toBe(0);
  });
});

describe("re-entry cooldown", () => {
  it("reports zero for a symbol that has not traded", () => {
    expect(reentryCooldownRemaining("NEVER_TRADED")).toBe(0);
  });
});
