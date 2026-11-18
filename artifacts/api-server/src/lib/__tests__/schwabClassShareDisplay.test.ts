process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/streamer_test";

import { beforeEach, describe, expect, it } from "vitest";
import {
  addSymbols,
  getQuoteBySymbol,
  registerWsBroadcast,
  __schwabClassShareTestReset,
  __schwabEquityProcessTickForTests,
} from "../schwabStreamer.js";

describe("schwab class-share display registry", () => {
  beforeEach(() => {
    __schwabClassShareTestReset();
    registerWsBroadcast(() => undefined);
  });

  it("updates and broadcasts both dot and slash displays for one stream key", () => {
    addSymbols(["BRK.B"]);
    addSymbols(["BRK/B"]);

    const broadcasts: string[] = [];
    registerWsBroadcast((event, data) => {
      if (event !== "quote" || !data || typeof data !== "object") return;
      const sym = (data as { symbol?: string }).symbol;
      if (sym) broadcasts.push(sym);
    });

    __schwabEquityProcessTickForTests([
      { key: "BRK/B", "3": 612.5, "12": 610, "1": 612.4, "2": 612.6 },
    ]);

    expect(getQuoteBySymbol("BRK.B")?.last).toBe(612.5);
    expect(getQuoteBySymbol("BRK/B")?.last).toBe(612.5);
    expect(broadcasts).toContain("BRK.B");
    expect(broadcasts).toContain("BRK/B");
  });

  it("shares cache across dot then slash subscription after a later tick", () => {
    addSymbols(["BRK.B"]);
    __schwabEquityProcessTickForTests([{ key: "BRK/B", "3": 600, "12": 590 }]);
    expect(getQuoteBySymbol("BRK.B")?.last).toBe(600);

    addSymbols(["BRK/B"]);
    __schwabEquityProcessTickForTests([{ key: "BRK/B", "3": 612.5, "12": 590 }]);
    expect(getQuoteBySymbol("BRK.B")?.last).toBe(612.5);
    expect(getQuoteBySymbol("BRK/B")?.last).toBe(612.5);
  });
});