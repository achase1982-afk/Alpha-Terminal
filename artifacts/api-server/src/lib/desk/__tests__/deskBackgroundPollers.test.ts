import { beforeEach, describe, expect, it, vi } from "vitest";

const pollTradier = vi.fn();
const pollAlpaca = vi.fn();
const pollNews = vi.fn();
const pollChains = vi.fn();

vi.mock("../deskSchwabChains.js", () => ({
  deskFetchSchwabChain: (...args: unknown[]) => pollChains(...args),
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
    pollTradier.mockReset();
    pollAlpaca.mockReset();
    pollNews.mockReset();
    pollChains.mockReset();
    pollTradier.mockResolvedValue(undefined);
    pollChains.mockResolvedValue(undefined);
    pollAlpaca.mockResolvedValue(undefined);
    pollNews.mockResolvedValue(undefined);
  });

  it("runs Tradier and news without UW in the same cycle", async () => {
    const { runDeskBackgroundPollCycle } = await import("../deskBackgroundPollers.js");
    await runDeskBackgroundPollCycle();
    expect(pollTradier).toHaveBeenCalled();
    expect(pollAlpaca).toHaveBeenCalled();
    expect(pollNews).toHaveBeenCalled();
  });

  it("finishes chains while news poll hangs", async () => {
    pollNews.mockImplementation(() => new Promise(() => undefined));
    pollAlpaca.mockImplementation(() => new Promise(() => undefined));
    let chainsDone = false;
    pollChains.mockImplementation(async () => {
      chainsDone = true;
    });
    const { runDeskBackgroundPollCycle } = await import("../deskBackgroundPollers.js");
    await runDeskBackgroundPollCycle();
    expect(chainsDone).toBe(true);
  });
});