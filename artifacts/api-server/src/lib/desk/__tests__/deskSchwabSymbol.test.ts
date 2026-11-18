process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/streamer_test";

import { describe, expect, it } from "vitest";
import { deskFormatSchwabSymbol } from "../deskSchwabSymbol.js";
import { schwabFuturesKey } from "../../schwabStreamer.js";

describe("deskFormatSchwabSymbol futures roots", () => {
  it("maps futures roots to front-month REST symbols", () => {
    expect(deskFormatSchwabSymbol("/ES")).toBe(schwabFuturesKey("/ES"));
    expect(deskFormatSchwabSymbol("/NQ")).toBe(schwabFuturesKey("/NQ"));
  });

  it("passes futures contracts through unchanged", () => {
    expect(deskFormatSchwabSymbol("/ESZ26")).toBe("/ESZ26");
  });

  it("maps class shares to Schwab slash symbology", () => {
    expect(deskFormatSchwabSymbol("BRK.B")).toBe("BRK/B");
    expect(deskFormatSchwabSymbol("BRK/B")).toBe("BRK/B");
    expect(deskFormatSchwabSymbol("BF.B")).toBe("BF/B");
  });
});