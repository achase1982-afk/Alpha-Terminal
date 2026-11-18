process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/streamer_test";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __deskStreamerSetWireTap,
  __deskStreamerWireTestPrime,
  __deskStreamerWireTestUnprime,
  addSymbols,
  deskFlowStreamerEnsureEquityL1,
  deskFlowStreamerEnsureTimesaleEquity,
} from "../schwabStreamer.js";

type WireReq = { service: string; command: string; parameters?: { keys?: string } };

function wireAddKeys(outbound: unknown[], service: string): string[] {
  const keys: string[] = [];
  for (const frame of outbound) {
    const body = frame as { requests?: WireReq[] };
    for (const r of body.requests ?? []) {
      if (r.service === service && r.command === "ADD" && r.parameters?.keys) {
        keys.push(...r.parameters.keys.split(","));
      }
    }
  }
  return keys;
}

describe("class-share desk live-flow streamer wire", () => {
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

  it("does not ADD BRK.B when app already SUBS BRK/B wire key", () => {
    outbound.length = 0;
    addSymbols(["BRK/B"]);
    outbound.length = 0;
    const performed = deskFlowStreamerEnsureEquityL1("BRK.B");
    expect(performed).toBe(false);
    const addKeys = wireAddKeys(outbound, "LEVELONE_EQUITIES");
    expect(addKeys).not.toContain("BRK.B");
    expect(addKeys.filter((k) => k === "BRK/B")).toHaveLength(0);
  });

  it("uses slash wire key for timesale ensure", () => {
    outbound.length = 0;
    deskFlowStreamerEnsureTimesaleEquity("BRK.B");
    const addKeys = wireAddKeys(outbound, "TIMESALE_EQUITY");
    expect(addKeys).toContain("BRK/B");
    expect(addKeys).not.toContain("BRK.B");
  });
});