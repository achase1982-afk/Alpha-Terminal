process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/streamer_test";

import { describe, expect, it } from "vitest";
import {
  isSchwabFuturesContractSymbol,
  schwabFuturesKey,
  SCHWAB_FUTURES_CONTRACT_RE,
} from "../schwabStreamer.js";

describe("schwabFuturesKey", () => {
  it("passes through full Schwab futures contract symbols unchanged", () => {
    expect(isSchwabFuturesContractSymbol("/NQZ26")).toBe(true);
    expect(schwabFuturesKey("/NQZ26")).toBe("/NQZ26");
    expect(schwabFuturesKey("/nqz26")).toBe("/NQZ26");
    expect(schwabFuturesKey("/MESZ26")).toBe("/MESZ26");
  });

  it("does not double-append month code on contract symbols", () => {
    const mapped = schwabFuturesKey("/NQZ26");
    expect(mapped).toBe("/NQZ26");
    expect(mapped).not.toBe("/NQZ26Z26");
  });

  it("maps bare quarterly roots to a month-coded contract", () => {
    const mapped = schwabFuturesKey("/ES");
    expect(SCHWAB_FUTURES_CONTRACT_RE.test(mapped)).toBe(true);
    expect(mapped.startsWith("/ES")).toBe(true);
  });

  it("maps /NQ and /MES roots to contract form", () => {
    for (const root of ["/NQ", "/MES"]) {
      const mapped = schwabFuturesKey(root);
      expect(SCHWAB_FUTURES_CONTRACT_RE.test(mapped)).toBe(true);
      expect(mapped.startsWith(root)).toBe(true);
    }
  });
});