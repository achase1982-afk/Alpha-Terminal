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
  addOptionSymbols,
  addOptionsBookSymbols,
  addSymbols,
  deskStreamerAddEquity,
  deskStreamerAfterLoginAppSubsThenDeskReplay,
  deskStreamerSetDeskOptions,
  deskStreamerSetDeskOptionsBook,
} from "../../schwabStreamer.js";

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

describe("schwabStreamer desk wire (mocked send)", () => {
  const outbound: unknown[] = [];

  beforeEach(() => {
    streamerSubResetForTests();
    outbound.length = 0;
    __deskStreamerWireTestUnprime();
    __deskStreamerWireTestPrime();
    __deskStreamerSetWireTap((p) => outbound.push(p));
  });

  afterEach(() => {
    __deskStreamerWireTestUnprime();
  });

  it("deskStreamerSetDeskOptions emits ADD/UNSUBS without touching app-held keys", async () => {
    addOptionSymbols(["APP_ROOT"]);
    await streamerSubApplyManagedOptionsSubscriptions();
    outbound.length = 0;
    deskStreamerAddEquity(["$SPX"]);
    deskStreamerSetDeskOptions(["APP_ROOT", "DESK_A", "DESK_B"]);
    const reqs = collectRequests(outbound);
    const unsubs = reqs.filter((r) => r.service === "LEVELONE_OPTIONS" && r.command === "UNSUBS");
    expect(unsubs.flatMap((r) => (r.parameters?.keys ?? "").split(",").filter(Boolean))).not.toContain(
      "APP_ROOT",
    );
    expect(reqs.some((r) => r.command === "ADD" && r.parameters?.keys?.includes("DESK_B"))).toBe(true);
  });

  it("deskStreamerSetDeskOptionsBook rolls universe with UNSUBS of old keys", () => {
    outbound.length = 0;
    deskStreamerSetDeskOptionsBook(["ROLL_A", "KEEP"]);
    outbound.length = 0;
    deskStreamerSetDeskOptionsBook(["KEEP", "ROLL_B"]);
    const reqs = collectRequests(outbound);
    const unsubs = reqs
      .filter((r) => r.service === "OPTIONS_BOOK" && r.command === "UNSUBS")
      .flatMap((r) => (r.parameters?.keys ?? "").split(",").filter(Boolean));
    expect(unsubs).toContain("ROLL_A");
    expect(unsubs).not.toContain("KEEP");
    expect(reqs.some((r) => r.service === "OPTIONS_BOOK" && r.command === "ADD" && r.parameters?.keys?.includes("ROLL_B"))).toBe(
      true,
    );
  });

  it("app equity SUBS then re-ADDs desk equities", () => {
    deskStreamerAddEquity(["$SPX", "SPY"]);
    outbound.length = 0;
    addSymbols(["QQQ"]);
    const reqs = collectRequests(outbound);
    const subs = reqs.find((r) => r.service === "LEVELONE_EQUITIES" && r.command === "SUBS");
    expect(subs).toBeDefined();
    const adds = reqs.filter((r) => r.service === "LEVELONE_EQUITIES" && r.command === "ADD");
    expect(adds.some((r) => r.parameters?.keys?.includes("$SPX"))).toBe(true);
  });

  it("login replay: one ADD batch per service (options split across 500-key batches)", () => {
    addSymbols(["QQQ"]);
    const manyDeskOpts = Array.from({ length: 501 }, (_, i) => `DESK_OPT_${i}`);
    deskStreamerSetDeskOptions(manyDeskOpts);
    deskStreamerAddEquity(["$SPX"]);
    deskStreamerSetDeskOptionsBook(["DESK_BOOK_1"]);
    outbound.length = 0;
    deskStreamerAfterLoginAppSubsThenDeskReplay();
    const reqs = collectRequests(outbound);
    expect(countAdds(reqs, "LEVELONE_EQUITIES")).toBe(1);
    expect(countAdds(reqs, "LEVELONE_OPTIONS")).toBe(2);
    expect(countAdds(reqs, "OPTIONS_BOOK")).toBe(1);
  });

  it("app options SUBS replays only desk options (no book/equity ADD)", async () => {
    deskStreamerAddEquity(["$SPX"]);
    deskStreamerSetDeskOptions(["DESK_OPT"]);
    deskStreamerSetDeskOptionsBook(["DESK_BOOK"]);
    outbound.length = 0;
    addOptionSymbols(["CLIENT_OPT"]);
    await streamerSubApplyManagedOptionsSubscriptions();
    const reqs = collectRequests(outbound);
    expect(countAdds(reqs, "LEVELONE_OPTIONS")).toBeGreaterThanOrEqual(1);
    expect(countAdds(reqs, "OPTIONS_BOOK")).toBe(0);
    expect(countAdds(reqs, "LEVELONE_EQUITIES")).toBe(0);
  });

  it("app OPTIONS_BOOK SUBS replays only desk book (no options/equity ADD)", async () => {
    deskStreamerAddEquity(["$SPX"]);
    deskStreamerSetDeskOptions(["DESK_OPT"]);
    deskStreamerSetDeskOptionsBook(["DESK_BOOK"]);
    outbound.length = 0;
    addOptionsBookSymbols(["CLIENT_BOOK"]);
    await streamerSubApplyManagedOptionsBookSubscriptions();
    const reqs = collectRequests(outbound);
    expect(countAdds(reqs, "OPTIONS_BOOK")).toBeGreaterThanOrEqual(1);
    expect(countAdds(reqs, "LEVELONE_OPTIONS")).toBe(0);
    expect(countAdds(reqs, "LEVELONE_EQUITIES")).toBe(0);
  });

  it("app LEVELONE_OPTIONS SUBS re-sends desk ADD batch", async () => {
    deskStreamerSetDeskOptions(["DESK_ONLY"]);
    outbound.length = 0;
    addOptionSymbols(["CLIENT_OPT"]);
    await streamerSubApplyManagedOptionsSubscriptions();
    const reqs = collectRequests(outbound);
    expect(reqs.some((r) => r.service === "LEVELONE_OPTIONS" && r.command === "SUBS")).toBe(true);
    expect(reqs.some((r) => r.service === "LEVELONE_OPTIONS" && r.command === "ADD")).toBe(true);
  });
});
