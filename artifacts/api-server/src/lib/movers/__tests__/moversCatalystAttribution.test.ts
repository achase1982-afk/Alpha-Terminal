import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Situation } from "@workspace/movers-types";
import { attributeMoversSituations } from "../moversCatalystAttribution.js";
import * as fmpMoversNews from "../fmpMoversNews.js";
import * as aiLabAnalystClient from "../../aiLabAnalystClient.js";

vi.mock("../fmpMoversNews.js", () => ({
  fetchHeadlinesForSituation: vi.fn(),
  formatHeadlinesForPrompt: vi.fn(() => "headline A"),
}));

vi.mock("../../aiLabAnalystClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof aiLabAnalystClient>();
  return {
    ...actual,
    callAnthropicWithSystem: vi.fn(),
  };
});

const fetchHeadlines = vi.mocked(fmpMoversNews.fetchHeadlinesForSituation);
const callAnthropic = vi.mocked(aiLabAnalystClient.callAnthropicWithSystem);

const baseSituation: Situation = {
  kind: "single",
  id: "NVTS",
  label: "NVTS",
  tickers: [
    {
      symbol: "NVTS",
      name: "Navitas Semiconductor",
      exchange: "NASDAQ",
      price: 29,
      changePct: 12.5,
    },
  ],
  catalystType: "NONE",
  catalyst: "",
  read: "",
  posture: "WAIT",
  confidence: "LOW",
};

beforeEach(() => {
  fetchHeadlines.mockReset();
  callAnthropic.mockReset();
  fetchHeadlines.mockResolvedValue([]);
});

describe("attributeMoversSituations", () => {
  it("places NONE catalyst situations into flagged", async () => {
    callAnthropic.mockResolvedValue(
      JSON.stringify({
        catalystType: "NONE",
        catalyst: "No clear headline catalyst",
        read: "Wait for confirmation",
        posture: "WAIT",
        confidence: "LOW",
      }),
    );

    const { situations, flagged } = await attributeMoversSituations([baseSituation], {
      provider: "anthropic",
      modelName: "claude-sonnet-4-6",
      temperature: 0,
    });

    expect(situations).toHaveLength(0);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.symbol).toBe("NVTS");
  });

  it("returns attributed situation when catalyst is identified", async () => {
    callAnthropic.mockResolvedValue(
      JSON.stringify({
        catalystType: "EARNINGS",
        catalyst: "Beat on revenue guidance.",
        read: "Fade after open unless volume holds.",
        posture: "WATCH",
        confidence: "HIGH",
      }),
    );

    const { situations, flagged } = await attributeMoversSituations([baseSituation], {
      provider: "anthropic",
      modelName: "claude-sonnet-4-6",
      temperature: 0,
    });

    expect(flagged).toHaveLength(0);
    expect(situations).toHaveLength(1);
    expect(situations[0]?.catalystType).toBe("EARNINGS");
    expect(situations[0]?.posture).toBe("WATCH");
    expect(situations[0]?.confidence).toBe("HIGH");
  });
});
