import { describe, expect, it, beforeEach } from "vitest";
import {
  getFlowActivityForKey,
  getFlowCountsForKey,
  ingestOptionTickForFlow,
  resetFlowClassifierWindow,
} from "./flowClassifier";
import type { OptionTick } from "@/lib/options-stream-store";

function tick(overrides: Partial<OptionTick> & { volume: number; last: number }): OptionTick {
  return {
    bid: 1,
    ask: 1.1,
    last: overrides.last,
    volume: overrides.volume,
    lastSize: overrides.lastSize,
    ...overrides,
  };
}

describe("flowClassifier window", () => {
  beforeEach(() => {
    resetFlowClassifierWindow();
  });

  it("expires activity outside windowMs", () => {
    const key = "SPX|7340|C";
    const t0 = 1_000_000;
    ingestOptionTickForFlow(key, tick({ volume: 0, last: 1.05 }), 30_000, t0);
    ingestOptionTickForFlow(key, tick({ volume: 10, last: 1.08 }), 30_000, t0 + 1_000);
    expect(getFlowActivityForKey(key, 30_000, t0 + 5_000)).toBe(10);
    expect(getFlowActivityForKey(key, 30_000, t0 + 40_000)).toBe(0);
    const c = getFlowCountsForKey(key, 30_000, t0 + 40_000);
    expect(c.buy + c.sell).toBe(0);
  });
});