import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STREAMER_L1_OPTIONS_CAP,
  streamerSubResetForTests,
  streamerSubSetDeskCore,
  streamerSubHold,
  streamerSubApplyManagedOptionsSubscriptions,
} from "../streamerSubscriptionManager.js";
import {
  __deskStreamerSetWireTap,
  __deskStreamerWireTestPrime,
  __deskStreamerWireTestUnprime,
  deskStreamerSetDeskOptions,
  getAppLevelOneOptionsCount,
  getDeskStreamerAddCounts,
  replaceManagedLevelOneOptionSubscriptions,
} from "../schwabStreamer.js";

type WireReq = { service: string; command: string; parameters?: { keys?: string } };

function collectRequests(outbound: unknown[]): WireReq[] {
  const reqs: WireReq[] = [];
  for (const frame of outbound) {
    const body = frame as { requests?: WireReq[] };
    if (Array.isArray(body.requests)) reqs.push(...body.requests);
  }
  return reqs;
}

describe("streamer subscription desk interplay", () => {
  const outbound: unknown[] = [];

  beforeEach(() => {
    streamerSubResetForTests();
    outbound.length = 0;
    __deskStreamerWireTestUnprime();
    __deskStreamerWireTestPrime();
    __deskStreamerSetWireTap((p) => outbound.push(p));
  });

  function subsCount(): number {
    return collectRequests(outbound).filter(
      (r) => r.service === "LEVELONE_OPTIONS" && r.command === "SUBS",
    ).length;
  }

  it("app SUBS excludes desk core and settles without oscillation", async () => {
    const desk = Array.from({ length: 150 }, (_, i) => `DESK-${i}`);
    const app = Array.from({ length: 40 }, (_, i) => `APP-${i}`);
    streamerSubSetDeskCore("LEVELONE_OPTIONS", desk);
    streamerSubHold("chain:test", "user_visible", "LEVELONE_OPTIONS", app);
    await streamerSubApplyManagedOptionsSubscriptions();
    expect(getAppLevelOneOptionsCount()).toBe(40);
    for (const k of desk) {
      expect(getAppLevelOneOptionsCount()).toBeLessThan(STREAMER_L1_OPTIONS_CAP);
    }
    await streamerSubApplyManagedOptionsSubscriptions();
    expect(subsCount()).toBeLessThanOrEqual(2);
  });

  it("tape transition keeps server L1 options count at or under cap", async () => {
    const cap = STREAMER_L1_OPTIONS_CAP;
    const assertCap = () => {
      const total = getAppLevelOneOptionsCount() + getDeskStreamerAddCounts().levelone_options;
      expect(total).toBeLessThanOrEqual(cap);
    };
    const gen = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
    streamerSubSetDeskCore("LEVELONE_OPTIONS", gen("DESK", 120));
    assertCap();
    streamerSubHold("app", "user_visible", "LEVELONE_OPTIONS", gen("APP", 200));
    await streamerSubApplyManagedOptionsSubscriptions();
    assertCap();
    deskStreamerSetDeskOptions(gen("DESK", 150));
    assertCap();
    streamerSubHold("app", "user_visible", "LEVELONE_OPTIONS", gen("APP2", 400));
    await streamerSubApplyManagedOptionsSubscriptions();
    assertCap();
    deskStreamerSetDeskOptions(gen("DESK", 90));
    assertCap();
  });

  it("empty managed plan sends UNSUBS not blank SUBS", () => {
    replaceManagedLevelOneOptionSubscriptions(["TEMP"]);
    outbound.length = 0;
    replaceManagedLevelOneOptionSubscriptions([]);
    const cmds = collectRequests(outbound);
    expect(cmds.some((c) => c.service === "LEVELONE_OPTIONS" && c.command === "UNSUBS")).toBe(true);
    expect(cmds.some((c) => c.service === "LEVELONE_OPTIONS" && c.command === "SUBS" && c.parameters?.keys === "")).toBe(
      false,
    );
  });
});