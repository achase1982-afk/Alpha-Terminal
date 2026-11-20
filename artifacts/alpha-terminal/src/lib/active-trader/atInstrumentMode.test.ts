import { describe, expect, it } from "vitest";
import {
  resolveInstrumentClass,
  resolveInstrumentTemplate,
  stockTemplateAvailable,
} from "./atInstrumentMode";

describe("resolveInstrumentClass", () => {
  it("falls back to equity for plain tickers before Schwab assetType arrives", () => {
    expect(resolveInstrumentClass(null, "AAPL")).toBe("equity");
    expect(resolveInstrumentClass("ETF", "SPY")).toBe("etf");
  });

  it("does not treat index or futures roots as equity", () => {
    expect(resolveInstrumentClass(null, "$SPX")).toBe("index");
    expect(resolveInstrumentClass(null, "/ES")).toBe("futures");
  });

  it("resolves SPX as an index when the ticker changes", () => {
    expect(resolveInstrumentClass(null, "SPX")).toBe("index");
    expect(resolveInstrumentClass(undefined, "spx")).toBe("index");
    expect(resolveInstrumentClass("EQUITY", "SPX")).toBe("index");
    expect(resolveInstrumentClass(null, "SPXW")).toBe("index");
    expect(stockTemplateAvailable(resolveInstrumentClass("EQUITY", "SPX"))).toBe(false);
    expect(resolveInstrumentTemplate("SPX", resolveInstrumentClass("EQUITY", "SPX"))).toBe("options");
    expect(resolveInstrumentTemplate("SPX", resolveInstrumentClass(null, "SPX"))).toBe("options");
  });
});

describe("resolveInstrumentTemplate", () => {
  it("defaults equity symbols to the penny share ladder", () => {
    expect(resolveInstrumentTemplate("AAPL", "equity")).toBe("stock");
    expect(resolveInstrumentTemplate("QQQ", "etf")).toBe("stock");
  });

  it("stays on options for index names", () => {
    expect(stockTemplateAvailable("index")).toBe(false);
    expect(resolveInstrumentTemplate("SPX", "index")).toBe("options");
  });
});