process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/streamer_test";

import { describe, expect, it } from "vitest";
import {
  registerSchwabIndexSymbols,
  selectPollSymbols,
  setSchwabIndexStreamFreshCheck,
  getSchwabIndexQuotesStreamHealth,
  SCHWAB_INDEX_STREAM_FRESH_MS,
} from "../schwabIndexQuotes.js";

describe("schwabIndexQuotes stream skip", () => {
  it("skips VIX family only when stream tick is fresh; REST fallback otherwise", () => {
    registerSchwabIndexSymbols(["$VIX", "$VIX9D", "$SPX"]);
    const now = 1_700_000_000_000;
    setSchwabIndexStreamFreshCheck((sym, t = now) => ({
      fresh: sym === "$VIX" && t - (now - 5_000) < SCHWAB_INDEX_STREAM_FRESH_MS,
      lastStreamMs: sym === "$VIX" ? now - 5_000 : null,
    }));
    const selected = selectPollSymbols(now);
    expect(selected).not.toContain("$VIX");
    expect(selected).toContain("$VIX9D");
    expect(selected).toContain("$SPX");
    const health = getSchwabIndexQuotesStreamHealth(now);
    expect(health.find((h) => h.symbol === "$VIX")?.rest_fallback).toBe(false);
    expect(health.find((h) => h.symbol === "$VIX9D")?.rest_fallback).toBe(true);
  });
});
