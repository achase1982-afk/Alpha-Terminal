process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/streamer_test";

import { beforeEach, describe, expect, it } from "vitest";
import { setFuturesActiveSymbolForRoot } from "../futuresFrontMonth.js";
import {
  addFuturesDisplay,
  addFuturesSymbols,
  getQuoteBySymbol,
  registerWsBroadcast,
  __schwabFuturesProcessTickForTests,
  __schwabFuturesStreamerTestReset,
} from "../schwabStreamer.js";

describe("schwab futures display registry", () => {
  beforeEach(() => {
    __schwabFuturesStreamerTestReset();
    registerWsBroadcast(() => undefined);
  });

  it("updates and broadcasts quotes for every display mapped to a stream key", () => {
    setFuturesActiveSymbolForRoot("/ES", "/ESZ26");
    addFuturesSymbols(["/ES"]);
    addFuturesSymbols(["/ESZ26"]);

    const broadcasts: string[] = [];
    registerWsBroadcast((event, data) => {
      if (event !== "quote" || !data || typeof data !== "object") return;
      const sym = (data as { symbol?: string }).symbol;
      if (sym) broadcasts.push(sym);
    });

    __schwabFuturesProcessTickForTests([
      {
        key: "/ESZ26",
        "3": 7400,
        "14": 7380,
        "1": 7399.75,
        "2": 7400.25,
      },
    ]);

    expect(getQuoteBySymbol("/ES")?.last).toBe(7400);
    expect(getQuoteBySymbol("/ESZ26")?.last).toBe(7400);
    expect(broadcasts).toContain("/ES");
    expect(broadcasts).toContain("/ESZ26");
  });

  it("addFuturesDisplay appends without overwriting an existing root mapping", () => {
    addFuturesDisplay("/ESZ26", "/ES");
    addFuturesDisplay("/ESZ26", "/ESZ26");
    addFuturesSymbols(["/MES"]);
    __schwabFuturesProcessTickForTests([{ key: "/ESZ26", "3": 100, "14": 99 }]);
    expect(getQuoteBySymbol("/ES")?.last).toBe(100);
    expect(getQuoteBySymbol("/ESZ26")?.last).toBe(100);
  });
});