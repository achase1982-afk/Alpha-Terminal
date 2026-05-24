import { describe, expect, it } from "vitest";
import type { Situation } from "@workspace/movers-types";
import { applyTier2ResultToSituation } from "../moversTier2Catalyst.js";
import type { MoversNewsHeadline } from "../fmpMoversNews.js";

const baseSituation: Situation = {
  kind: "single",
  id: "FUTU",
  label: "FUTU",
  tickers: [
    {
      symbol: "FUTU",
      name: "Futu Holdings",
      exchange: "NASDAQ",
      price: 89,
      changePct: 12.5,
    },
  ],
  catalystType: "UNKNOWN",
  catalyst: "placeholder",
  newsKey: "",
};

describe("applyTier2ResultToSituation", () => {
  const headlines: MoversNewsHeadline[] = [
    {
      symbol: "FUTU",
      publishedAt: "2026-05-24T10:00:00Z",
      title: "China regulatory crackdown hits online broker stocks",
      source: "Reuters",
      kind: "news",
    },
  ];

  it("sets GOV and driving headline without changing numeric fields", () => {
    const updated = applyTier2ResultToSituation(baseSituation, headlines, {
      ticker: "FUTU",
      catalystType: "GOV",
      drivingHeadline: "China regulatory crackdown hits online broker stocks",
    });
    expect(updated.catalystType).toBe("GOV");
    expect(updated.catalyst).toContain("regulatory crackdown");
    expect(updated.newsKey).toHaveLength(40);
    expect(updated.tickers[0]?.price).toBe(89);
    expect(updated.tickers[0]?.changePct).toBe(12.5);
  });

  it("sets NONE with empty catalyst fields", () => {
    const updated = applyTier2ResultToSituation(baseSituation, headlines, {
      ticker: "FUTU",
      catalystType: "NONE",
      drivingHeadline: "",
    });
    expect(updated.catalystType).toBe("NONE");
    expect(updated.catalyst).toBe("");
    expect(updated.newsKey).toBe("");
  });
});
