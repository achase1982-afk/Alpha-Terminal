import { beforeEach, describe, expect, it, vi } from "vitest";

const pollTradier = vi.fn();
const pollAlpaca = vi.fn();
const fetchNews = vi.fn();
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
  deskFetchNews: (...args: unknown[]) => fetchNews(...args),
}));

describe("runDeskBackgroundPollCycle", () => {
  beforeEach(async () => {
    vi.resetModules();
    pollTradier.mockReset();
    pollAlpaca.mockReset();
    fetchNews.mockReset();
    pollChains.mockReset();
    pollTradier.mockResolvedValue(undefined);
    pollChains.mockResolvedValue(undefined);
    pollAlpaca.mockResolvedValue(undefined);
    fetchNews.mockResolvedValue({ ok: true, articles: [], asOfMs: Date.now() });
    const { deskResetBackgroundNewsPollGuardsForTests } = await import("../deskBackgroundPollers.js");
    deskResetBackgroundNewsPollGuardsForTests();
  });

  it("runs Tradier and news without UW in the same cycle", async () => {
    const { runDeskBackgroundPollCycle } = await import("../deskBackgroundPollers.js");
    await runDeskBackgroundPollCycle();
    expect(pollTradier).toHaveBeenCalled();
    expect(pollAlpaca).toHaveBeenCalled();
    expect(fetchNews).toHaveBeenCalled();
  });

  it("finishes chains while news poll hangs", async () => {
    fetchNews.mockImplementation(() => new Promise(() => undefined));
    pollAlpaca.mockImplementation(() => new Promise(() => undefined));
    let chainsDone = false;
    pollChains.mockImplementation(async () => {
      chainsDone = true;
    });
    const { runDeskBackgroundPollCycle } = await import("../deskBackgroundPollers.js");
    await runDeskBackgroundPollCycle();
    expect(chainsDone).toBe(true);
  });

  it("skips a stalled Finnhub news poll when the prior run is still in flight", async () => {
    fetchNews.mockImplementation(() => new Promise(() => undefined));
    pollAlpaca.mockResolvedValue(undefined);
    const { runDeskBackgroundPollCycle } = await import("../deskBackgroundPollers.js");
    await runDeskBackgroundPollCycle();
    expect(fetchNews).toHaveBeenCalledTimes(1);
    await runDeskBackgroundPollCycle();
    expect(fetchNews).toHaveBeenCalledTimes(1);
  });
});
