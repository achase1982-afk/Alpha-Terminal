import { describe, expect, it } from "vitest";
import { registerSchwabIndexSymbols, selectPollSymbols } from "../schwabIndexQuotes.js";

describe("schwabIndexQuotes stream skip", () => {
  it("omits VIX family indices served on L1 stream", () => {
    registerSchwabIndexSymbols(["$VIX", "$VIX9D", "$SPX"]);
    const selected = selectPollSymbols();
    expect(selected).not.toContain("$VIX");
    expect(selected).not.toContain("$VIX9D");
    expect(selected).toContain("$SPX");
  });
});