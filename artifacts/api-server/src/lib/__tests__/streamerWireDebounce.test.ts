import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STREAMER_WIRE_DEBOUNCE_MAX_MS,
  STREAMER_WIRE_DEBOUNCE_MS,
  streamerSubFlushWireForTests,
  streamerSubHold,
  streamerSubResetForTests,
} from "../streamerSubscriptionManager.js";
import {
  __deskStreamerSetWireTap,
  __deskStreamerWireTestPrime,
  __deskStreamerWireTestUnprime,
} from "../schwabStreamer.js";
import { streamerWireSimulatorResetForTests } from "../streamerWireSimulator.js";

type WireReq = { service: string; command: string };

function subsCount(outbound: unknown[]): number {
  let n = 0;
  for (const frame of outbound) {
    const body = frame as { requests?: WireReq[] };
    for (const r of body.requests ?? []) {
      if (r.service === "LEVELONE_OPTIONS" && r.command === "SUBS") n += 1;
    }
  }
  return n;
}

describe("streamer wire debounce", () => {
  const outbound: unknown[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    streamerSubResetForTests();
    streamerWireSimulatorResetForTests();
    outbound.length = 0;
    __deskStreamerWireTestUnprime();
    __deskStreamerWireTestPrime();
    __deskStreamerSetWireTap((p) => outbound.push(p));
  });

  afterEach(() => {
    vi.useRealTimers();
    __deskStreamerWireTestUnprime();
  });

  it("coalesces 20 hold updates into at most 2 SUBS within 1s", async () => {
    for (let i = 0; i < 20; i++) {
      streamerSubHold(`stream:debounce:chain:view-${i}`, "user_visible", "LEVELONE_OPTIONS", [
        `OPT-${i}`,
      ]);
    }
    await vi.advanceTimersByTimeAsync(1_000);
    await streamerSubFlushWireForTests();
    expect(subsCount(outbound)).toBeLessThanOrEqual(2);
    expect(STREAMER_WIRE_DEBOUNCE_MS).toBeGreaterThanOrEqual(300);
    expect(STREAMER_WIRE_DEBOUNCE_MS).toBeLessThanOrEqual(500);
  });

  it("fires at least one SUBS under continuous churn within maxWait", async () => {
    outbound.length = 0;
    for (let t = 0; t < 1_200; t += 50) {
      streamerSubHold(`stream:churn:chain:v-${t}`, "user_visible", "LEVELONE_OPTIONS", [`K-${t}`]);
      await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(STREAMER_WIRE_DEBOUNCE_MAX_MS);
    await streamerSubFlushWireForTests();
    expect(subsCount(outbound)).toBeGreaterThanOrEqual(1);
    expect(subsCount(outbound)).toBeLessThanOrEqual(3);
  });
});
