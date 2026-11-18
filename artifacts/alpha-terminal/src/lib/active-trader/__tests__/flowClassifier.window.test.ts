import { describe, expect, it, vi, afterEach } from "vitest";
import {
  getFlowCountsForKey,
  ingestOptionTickForFlow,
  resetFlowClassifierWindow,
} from "@/lib/active-trader/flowClassifier";
import type { OptionTick } from "@/lib/options-stream-store";

const baseTick = (): OptionTick => ({
  bid: 1,
  ask: 1.1,
  last: 1.05,
  volume: 10,
  bidSize: 1,
  askSize: 1,
});

describe("flowClassifier rolling window", () => {
  afterEach(() => {
    resetFlowClassifierWindow();
    vi.useRealTimers();
  });

  it("expires counts after windowMs", () => {
    vi.useFakeTimers();
    const key = "SPX|test";
    ingestOptionTickForFlow(key, { ...baseTick(), volume: 20 }, 30_000);
    const tick2: OptionTick = { ...baseTick(), volume: 30, last: 1.08 };
    ingestOptionTickForFlow(key, tick2, 30_000);
    expect(getFlowCountsForKey(key, 30_000).buy + getFlowCountsForKey(key, 30_000).sell).toBeGreaterThan(0);
    vi.advanceTimersByTime(31_000);
    const fresh = getFlowCountsForKey(key, 30_000);
    expect(fresh.buy + fresh.sell + fresh.even).toBe(0);
  });
});