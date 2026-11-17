process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/streamer_test";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getStreamerSubscriptionHealth,
  streamerSubFlushWireForTests,
  streamerSubResetForTests,
  streamerSubSetDeskCore,
} from "../../streamerSubscriptionManager.js";
import {
  __deskStreamerSetWireTap,
  __deskStreamerWireTestPrime,
  __deskStreamerWireTestUnprime,
  __schwabStreamerApplyLevelOneOptionsCapRejectionForTests,
  __streamerWireDeskKeysOnServer,
  addOptionSymbols,
  addOptionsBookSymbols,
  addSymbols,
  deskStreamerAddEquity,
  deskStreamerAfterLoginAppSubsThenDeskReplay,
  deskStreamerSetDeskOptions,
  deskStreamerSetDeskOptionsBook,
} from "../../schwabStreamer.js";
import { deskComputeDeskLevelOneOptionsBudget } from "../deskStreamerBudget.js";
import {
  streamerWireSimulatorLevelOneAddPressure,
  streamerWireSimulatorResetForTests,
} from "../../streamerWireSimulator.js";

type WireReq = { service: string; command: string; parameters?: { keys?: string } };

function collectRequests(outbound: unknown[]): WireReq[] {
  const reqs: WireReq[] = [];
  for (const frame of outbound) {
    const body = frame as { requests?: WireReq[] };
    if (Array.isArray(body.requests)) reqs.push(...body.requests);
  }
  return reqs;
}

function countAdds(reqs: WireReq[], service: string): number {
  return reqs.filter((r) => r.service === service && r.command === "ADD").length;
}

function countSubs(reqs: WireReq[], service: string): number {
  return reqs.filter((r) => r.service === service && r.command === "SUBS").length;
}

describe("schwabStreamer desk wire (mocked send)", () => {
  const outbound: unknown[] = [];

  beforeEach(() => {
    streamerSubResetForTests();
    streamerWireSimulatorResetForTests();
    outbound.length = 0;
    __deskStreamerWireTestUnprime();
    __deskStreamerWireTestPrime();
    __deskStreamerSetWireTap((p) => outbound.push(p));
  });

  afterEach(() => {
    __deskStreamerWireTestUnprime();
  });

  it("deskStreamerSetDeskOptions emits ADD without app SUBS", async () => {
    addOptionSymbols(["APP_ROOT"]);
    await streamerSubFlushWireForTests();
    outbound.length = 0;
    deskStreamerSetDeskOptions(["DESK_ONLY"]);
    const reqs = collectRequests(outbound);
    expect(countAdds(reqs, "LEVELONE_OPTIONS")).toBeGreaterThanOrEqual(1);
    expect(countSubs(reqs, "LEVELONE_OPTIONS")).toBe(0);
  });

  it("desk keys survive app managed SUBS (wire simulator)", async () => {
    deskStreamerSetDeskOptions(["DESK-A", "DESK-B"]);
    outbound.length = 0;
    addOptionSymbols(["CLIENT_OPT"]);
    await streamerSubFlushWireForTests();
    const wireDesk = __streamerWireDeskKeysOnServer();
    expect(wireDesk.has("DESK-A")).toBe(true);
    expect(wireDesk.has("DESK-B")).toBe(true);
  });

  it("deskStreamerAfterLoginAppSubsThenDeskReplay restores desk on wire", () => {
    deskStreamerAddEquity(["$SPX"]);
    deskStreamerSetDeskOptions(["DESK_ONE"]);
    deskStreamerSetDeskOptionsBook(["DESK_BOOK"]);
    outbound.length = 0;
    deskStreamerAfterLoginAppSubsThenDeskReplay();
    expect(__streamerWireDeskKeysOnServer().size).toBeGreaterThanOrEqual(1);
  });

  it("app options SUBS sends SUBS then desk ADD on wire", async () => {
    deskStreamerSetDeskOptions(["DESK_OPT"]);
    outbound.length = 0;
    addOptionSymbols(["CLIENT_OPT"]);
    await streamerSubFlushWireForTests();
    expect(countSubs(collectRequests(outbound), "LEVELONE_OPTIONS")).toBeGreaterThanOrEqual(1);
    expect(__streamerWireDeskKeysOnServer().has("DESK_OPT")).toBe(true);
  });

  it("login desk replay emits six LEVELONE_OPTIONS ADD batches for full desk (2822), not twelve", () => {
    const deskN = deskComputeDeskLevelOneOptionsBudget(0);
    expect(deskN).toBe(2822);
    const desk = Array.from({ length: deskN }, (_, i) => `DESK-L1-${i}`);
    streamerSubSetDeskCore("LEVELONE_OPTIONS", desk);
    deskStreamerSetDeskOptions(desk);
    const pressureBefore = streamerWireSimulatorLevelOneAddPressure();
    outbound.length = 0;
    deskStreamerAfterLoginAppSubsThenDeskReplay();
    const reqs = collectRequests(outbound);
    expect(countAdds(reqs, "LEVELONE_OPTIONS")).toBe(6);
    expect(streamerWireSimulatorLevelOneAddPressure() - pressureBefore).toBe(deskN);
  });

  it("login desk replay still emits one replay when app LEVELONE_OPTIONS SUBS runs", async () => {
    const desk = Array.from({ length: 1200 }, (_, i) => `DESK-${i}`);
    streamerSubSetDeskCore("LEVELONE_OPTIONS", desk);
    deskStreamerSetDeskOptions(desk);
    addOptionSymbols(["CLIENT-OPT"]);
    await streamerSubFlushWireForTests();
    outbound.length = 0;
    deskStreamerAfterLoginAppSubsThenDeskReplay();
    const reqs = collectRequests(outbound);
    expect(countSubs(reqs, "LEVELONE_OPTIONS")).toBe(1);
    expect(countAdds(reqs, "LEVELONE_OPTIONS")).toBe(3);
  });

  it("desk-only cap ADD rejection records cap_discard_unattributed in health", () => {
    const desk = ["DESK-A", "DESK-B"];
    streamerSubSetDeskCore("LEVELONE_OPTIONS", desk);
    deskStreamerSetDeskOptions(desk);
    outbound.length = 0;
    deskStreamerAfterLoginAppSubsThenDeskReplay();
    __schwabStreamerApplyLevelOneOptionsCapRejectionForTests(
      "maximum number of symbols allowed (LEVELONE_OPTIONS=3000, DISCARDED=322)",
    );
    const h = getStreamerSubscriptionHealth();
    expect(h.levelone_options.live_app).toBe(0);
    expect(h.levelone_options.wire_degraded).toBe(true);
    expect(h.streamer_add_rejections.some((r) => r.reason === "cap_discard_unattributed")).toBe(true);
  });
});
