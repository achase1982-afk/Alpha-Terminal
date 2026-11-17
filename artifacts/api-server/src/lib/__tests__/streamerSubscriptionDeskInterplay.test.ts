import { beforeEach, describe, expect, it } from "vitest";
import {
  STREAMER_L1_OPTIONS_CAP,
  streamerSubResetForTests,
  streamerSubSetDeskCore,
  streamerSubHold,
  streamerSubApplyManagedOptionsSubscriptions,
} from "../streamerSubscriptionManager.js";
import { APP_L1_OPTIONS_MAX, deskAppLevelOneOptionsCap, deskComputeDeskLevelOneOptionsBudget } from "../desk/deskStreamerBudget.js";
import {
  __deskStreamerSetWireTap,
  __deskStreamerWireTestPrime,
  __deskStreamerWireTestUnprime,
  __streamerWireDeskKeysOnServer,
  __streamerWirePeakLevelOneOptionsForTests,
  __streamerWirePeakResetForTests,
  __streamerWireServerLevelOneOptionsCount,
  deskStreamerSetDeskOptions,
  deskStreamerUnsubRemovedDeskOptions,
  getAppLevelOneOptionsCount,
  replaceManagedLevelOneOptionSubscriptions,
} from "../schwabStreamer.js";
import { streamerWireSimulatorResetForTests } from "../streamerWireSimulator.js";

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
    streamerWireSimulatorResetForTests();
    outbound.length = 0;
    __deskStreamerWireTestUnprime();
    __deskStreamerWireTestPrime();
    __deskStreamerSetWireTap((p) => outbound.push(p));
    __streamerWirePeakResetForTests();
  });

  function assertCap(): void {
    expect(__streamerWireServerLevelOneOptionsCount()).toBeLessThanOrEqual(STREAMER_L1_OPTIONS_CAP);
    expect(__streamerWirePeakLevelOneOptionsForTests()).toBeLessThanOrEqual(STREAMER_L1_OPTIONS_CAP);
  }

  function subsCount(): number {
    return collectRequests(outbound).filter(
      (r) => r.service === "LEVELONE_OPTIONS" && r.command === "SUBS",
    ).length;
  }

  const gen = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

  it("desk keys remain on wire after app SUBS", async () => {
    const desk = gen("DESK", 150);
    const app = gen("APP", 40);
    deskStreamerSetDeskOptions(desk);
    streamerSubSetDeskCore("LEVELONE_OPTIONS", desk);
    streamerSubHold("chain:test", "user_visible", "LEVELONE_OPTIONS", app);
    await streamerSubApplyManagedOptionsSubscriptions();
    expect(getAppLevelOneOptionsCount()).toBe(40);
    const wireDesk = __streamerWireDeskKeysOnServer();
    expect(wireDesk.size).toBe(150);
    for (const k of desk) expect(wireDesk.has(k)).toBe(true);
    await streamerSubApplyManagedOptionsSubscriptions();
    expect(subsCount()).toBeLessThanOrEqual(2);
    assertCap();
  });

  it("8000-key hold and repeated core refresh keeps desk on wire and app cap", async () => {
    const deskTarget = deskComputeDeskLevelOneOptionsBudget(0);
    const desk = gen("DESK", deskTarget);
    streamerSubSetDeskCore("LEVELONE_OPTIONS", desk);
    streamerSubHold("chain:8000", "user_visible", "LEVELONE_OPTIONS", gen("H", 8_000));
    for (let i = 0; i < 10; i++) {
      streamerSubSetDeskCore("LEVELONE_OPTIONS", desk);
      await streamerSubApplyManagedOptionsSubscriptions();
      deskStreamerSetDeskOptions(desk);
      expect(getAppLevelOneOptionsCount()).toBeLessThanOrEqual(deskAppLevelOneOptionsCap());
      expect(getAppLevelOneOptionsCount()).toBeLessThanOrEqual(APP_L1_OPTIONS_MAX);
      expect(__streamerWireDeskKeysOnServer().size).toBeGreaterThan(0);
      assertCap();
    }
  });

  it("wire transitions stay within cap (shrink, grow, app 500 and 8000 holds)", async () => {
    __streamerWirePeakResetForTests();
    streamerSubSetDeskCore("LEVELONE_OPTIONS", gen("D", 200));
    await streamerSubApplyManagedOptionsSubscriptions();
    assertCap();
    deskStreamerSetDeskOptions(gen("D", 150));
    assertCap();
    deskStreamerSetDeskOptions(gen("D", 220));
    assertCap();
    streamerSubHold("app500", "user_visible", "LEVELONE_OPTIONS", gen("A", 500));
    await streamerSubApplyManagedOptionsSubscriptions();
    assertCap();
    streamerSubHold("app8k", "user_visible", "LEVELONE_OPTIONS", gen("B", 8_000));
    await streamerSubApplyManagedOptionsSubscriptions();
    assertCap();
    const removed = gen("D", 50);
    deskStreamerUnsubRemovedDeskOptions(removed);
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
