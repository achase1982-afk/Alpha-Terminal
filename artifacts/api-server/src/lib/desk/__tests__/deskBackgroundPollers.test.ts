import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../deskUwLiveFeeds.js", () => ({
  refreshDeskUwLiveFeeds: vi.fn(async () => {
    throw new Error("UW timeout");
  }),
}));

vi.mock("../deskUnusualWhales.js", () => ({
  deskFetchUwFlow: vi.fn(async () => {
    throw new Error("UW flow timeout");
  }),
}));

const pollTradier = vi.fn();
const pollAlpaca = vi.fn();
const pollNews = vi.fn();

vi.mock("../deskSchwabChains.js", () => ({
  deskFetchSchwabChain: vi.fn(async () => undefined),
}));

vi.mock("../deskTradier.js", () => ({
  getTradierToken: () => "token",
  deskTradierQuotes: (...args: unknown[]) => pollTradier(...args),
}));

vi.mock("../deskAlpacaNews.js", () => ({
  deskProbeAlpacaNews: () => pollAlpaca(),
}));

vi.mock("../deskNews.js", () => ({
  deskFetchNews: () => pollNews(),
}));

describe("runDeskBackgroundPollCycle", () => {
  beforeEach(() => {
    pollTradier.mockClear();
    pollAlpaca.mockClear();
    pollNews.mockClear();
  });

  it("still runs Tradier and news when UW refresh throws", async () => {
    const { runDeskBackgroundPollCycle } = await import("../deskBackgroundPollers.js");
    await runDeskBackgroundPollCycle();
    expect(pollTradier).toHaveBeenCalled();
    expect(pollAlpaca).toHaveBeenCalled();
    expect(pollNews).toHaveBeenCalled();
  });
});