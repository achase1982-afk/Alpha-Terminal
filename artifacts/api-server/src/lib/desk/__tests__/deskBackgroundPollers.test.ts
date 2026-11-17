import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("runs Tradier and news without UW in the same cycle", async () => {
    const { runDeskBackgroundPollCycle } = await import("../deskBackgroundPollers.js");
    await runDeskBackgroundPollCycle();
    expect(pollTradier).toHaveBeenCalled();
    expect(pollAlpaca).toHaveBeenCalled();
    expect(pollNews).toHaveBeenCalled();
  });
});
