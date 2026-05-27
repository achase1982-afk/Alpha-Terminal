import { describe, expect, it } from "vitest";
import type { Situation } from "@workspace/movers-types";
import type { MoversNewsHeadline } from "../fmpMoversNews.js";
import { shouldRunMoversWebFallback } from "../moversCatalystRead.js";

function headline(title: string): MoversNewsHeadline {
  return { symbol: "XYZ", publishedAt: "2026-05-24T12:00:00Z", title, source: "", kind: "news" };
}

const moverSituation: Situation = {
  kind: "single",
  id: "XYZ",
  label: "XYZ",
  tickers: [
    {
      symbol: "XYZ",
      name: "Example Co",
      exchange: "NASDAQ",
      price: 50,
      changePct: 15,
    },
  ],
  catalystType: "UNKNOWN",
  catalyst: "",
  newsKey: "",
};

const smallMoveSituation: Situation = {
  ...moverSituation,
  tickers: [{ ...moverSituation.tickers[0]!, changePct: 5 }],
};

describe("shouldRunMoversWebFallback", () => {
  it("runs when FMP headlines are empty", () => {
    expect(shouldRunMoversWebFallback([], null, moverSituation)).toBe(true);
  });

  it("runs for large moves when selected headline has no hard-catalyst keyword", () => {
    const headlines = [headline("Sector rotation lifts software names")];
    const selected = headlines[0]!;
    expect(shouldRunMoversWebFallback(headlines, selected, moverSituation)).toBe(true);
  });

  it("skips web fallback for large moves when selected headline has hard-catalyst signal", () => {
    const headlines = [headline("Analyst upgrades XYZ, raises price target")];
    const selected = headlines[0]!;
    expect(shouldRunMoversWebFallback(headlines, selected, moverSituation)).toBe(false);
  });

  it("skips web fallback for ambient headlines on small moves", () => {
    const headlines = [headline("Sector rotation lifts software names")];
    const selected = headlines[0]!;
    expect(shouldRunMoversWebFallback(headlines, selected, smallMoveSituation)).toBe(false);
  });
});
