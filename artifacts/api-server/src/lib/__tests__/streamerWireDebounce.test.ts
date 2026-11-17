import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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
});