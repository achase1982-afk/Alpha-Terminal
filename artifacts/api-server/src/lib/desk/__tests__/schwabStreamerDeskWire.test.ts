process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/streamer_test";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  streamerSubApplyManagedOptionsBookSubscriptions,
  streamerSubApplyManagedOptionsSubscriptions,
  streamerSubResetForTests,
} from "../../streamerSubscriptionManager.js";
import {
  __deskStreamerSetWireTap,
  __deskStreamerWireTestPrime,
  __deskStreamerWireTestUnprime,
  __streamerWireDeskKeysOnServer,
  addOptionSymbols,
  addOptionsBookSymbols,
  addSymbols,
  deskStreamerAddEquity,
  deskStreamerAfterLoginAppSubsThenDeskReplay,
  deskStreamerSetDeskOptions,
  deskStreamerSetDeskOptionsBook,
} from "../../schwabStreamer.js";
import { streamerWireSimulatorResetForTests } from "../../streamerWireSimulator.js";

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
    await streamerSubApplyManagedOptionsSubscriptions();
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
    await streamerSubApplyManagedOptionsSubscriptions();
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
    await streamerSubApplyManagedOptionsSubscriptions();
    expect(countSubs(collectRequests(outbound), "LEVELONE_OPTIONS")).toBeGreaterThanOrEqual(1);
    expect(__streamerWireDeskKeysOnServer().has("DESK_OPT")).toBe(true);
  });
});
