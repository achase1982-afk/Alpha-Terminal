import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Situation } from "@workspace/movers-types";
import {
  applyTier2ResultToSituation,
  classifyUnknownResidualWithTier2,
} from "../moversTier2Catalyst.js";
import type { MoversNewsHeadline } from "../fmpMoversNews.js";
import * as moversTier2Cache from "../moversTier2Cache.js";
import * as aiLabAnalystClient from "../../aiLabAnalystClient.js";

vi.mock("../../aiLabConfig.js", () => ({
  getMoversAiConfig: () => ({
    provider: "anthropic",
    modelName: "claude-sonnet-4-6",
    temperature: 0,
  }),
}));

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

describe("classifyUnknownResidualWithTier2 cache", () => {
  const headlines: MoversNewsHeadline[] = [
    {
      symbol: "FUTU",
      publishedAt: "2026-05-24T10:00:00Z",
      title: "China regulatory crackdown hits online broker stocks",
      source: "Reuters",
      kind: "news",
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses cache without calling the LLM when headline set is unchanged", async () => {
    vi.spyOn(moversTier2Cache, "buildHeadlineSetKey").mockReturnValue("headline-key-1");
    vi.spyOn(moversTier2Cache, "getTier2CacheEntry").mockResolvedValue({
      catalystType: "GOV",
      drivingHeadline: "China regulatory crackdown hits online broker stocks",
    });
    const llmSpy = vi.spyOn(aiLabAnalystClient, "callAnthropicWithSystem");

    const result = await classifyUnknownResidualWithTier2([
      { situation: baseSituation, headlines },
    ]);

    expect(result.tier2CacheHits).toBe(1);
    expect(result.tier2LlmBatchSize).toBe(0);
    expect(result.tier2Assigned).toBe(1);
    expect(result.situations[0]?.catalystType).toBe("GOV");
    expect(llmSpy).not.toHaveBeenCalled();
  });

  it("sends only cache misses to the LLM batch", async () => {
    vi.spyOn(moversTier2Cache, "buildHeadlineSetKey")
      .mockReturnValueOnce("cached-key")
      .mockReturnValueOnce("fresh-key");
    vi.spyOn(moversTier2Cache, "getTier2CacheEntry")
      .mockResolvedValueOnce({
        catalystType: "GOV",
        drivingHeadline: "China regulatory crackdown hits online broker stocks",
      })
      .mockResolvedValueOnce(null);
    vi.spyOn(moversTier2Cache, "writeTier2CacheEntry").mockResolvedValue(undefined);
    vi.spyOn(aiLabAnalystClient, "callAnthropicWithSystem").mockResolvedValue(
      JSON.stringify({
        results: [
          {
            ticker: "NVTS",
            catalystType: "EARNINGS",
            drivingHeadline: "NVTS beats earnings estimates",
          },
        ],
      }),
    );

    const nvts: Situation = {
      ...baseSituation,
      id: "NVTS",
      label: "NVTS",
      tickers: [{ ...baseSituation.tickers[0]!, symbol: "NVTS", changePct: 8.1 }],
    };

    const result = await classifyUnknownResidualWithTier2([
      { situation: baseSituation, headlines },
      {
        situation: nvts,
        headlines: [
          {
            symbol: "NVTS",
            publishedAt: "2026-05-24T11:00:00Z",
            title: "NVTS beats earnings estimates",
            source: "",
            kind: "news",
          },
        ],
      },
    ]);

    expect(result.tier2CacheHits).toBe(1);
    expect(result.tier2LlmBatchSize).toBe(1);
    expect(aiLabAnalystClient.callAnthropicWithSystem).toHaveBeenCalledTimes(1);
    const nvtsOut = result.situations.find((s) => s.id === "NVTS");
    expect(nvtsOut?.catalystType).toBe("EARNINGS");
  });
});
