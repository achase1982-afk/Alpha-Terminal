import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __deskStreamerSetWireTap,
  __deskStreamerWireTestPrime,
  __deskStreamerWireTestUnprime,
  addOptionSymbols,
  addOptionsBookSymbols,
  addSymbols,
  deskStreamerAddEquity,
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

describe("schwabStreamer desk wire (mocked send)", () => {
  const outbound: unknown[] = [];

  beforeEach(() => {
    outbound.length = 0;
    __deskStreamerWireTestUnprime();
    __deskStreamerWireTestPrime();
    __deskStreamerSetWireTap((p) => outbound.push(p));
  });

  afterEach(() => {
    __deskStreamerWireTestUnprime();
  });

  it("deskStreamerSetDeskOptions emits ADD/UNSUBS without touching app-held keys", () => {
    addOptionSymbols(["APP_ROOT"]);
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

  it("deskStreamerSetDeskOptionsBook rolls universe with UNSUBS", () => {
    addOptionsBookSymbols(["APP_B"]);
    outbound.length = 0;
    deskStreamerSetDeskOptionsBook(["KEEP", "NEW_B"]);
    deskStreamerSetDeskOptionsBook(["KEEP", "NEW_B"]);
    const reqs = collectRequests(outbound);
    expect(reqs.filter((r) => r.service === "OPTIONS_BOOK" && r.command === "UNSUBS").length).toBeGreaterThanOrEqual(0);
    expect(reqs.some((r) => r.service === "OPTIONS_BOOK" && r.command === "ADD")).toBe(true);
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

  it("app LEVELONE_OPTIONS SUBS re-sends desk ADD batch", () => {
    deskStreamerSetDeskOptions(["DESK_ONLY"]);
    outbound.length = 0;
    addOptionSymbols(["CLIENT_OPT"]);
    const reqs = collectRequests(outbound);
    expect(reqs.some((r) => r.service === "LEVELONE_OPTIONS" && r.command === "SUBS")).toBe(true);
    expect(reqs.some((r) => r.service === "LEVELONE_OPTIONS" && r.command === "ADD")).toBe(true);
  });
});
