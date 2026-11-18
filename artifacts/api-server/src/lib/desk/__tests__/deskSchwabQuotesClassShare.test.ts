import { beforeEach, describe, expect, it, vi } from "vitest";

const restFetch = vi.fn();

vi.mock("../deskSchwabRestCredential.js", () => ({
  deskSchwabRestFetch: (...args: unknown[]) => restFetch(...args),
  deskSchwabQuotesFeed: () => "schwab_quotes_rest",
  deskSchwabMarkApp2AuthFailure: () => undefined,
}));

vi.mock("../deskFeedFreshness.js", () => ({
  deskTouchFeed: () => undefined,
  deskMarkFeedError: () => undefined,
  deskMarkAuthFail: () => undefined,
  deskMarkFeedNotAuthorized: () => undefined,
}));

describe("deskFetchSchwabQuotes class shares", () => {
  beforeEach(() => {
    restFetch.mockReset();
    restFetch.mockResolvedValue({
      res: {
        status: 200,
        ok: true,
        json: async () => ({
          "BRK/B": { quote: { lastPrice: 612.5 } },
        }),
      },
      app: "app2",
      fellBack: false,
      token: "tok",
    });
  });

  it("requests Schwab slash symbology and returns caller dot symbol", async () => {
    const { deskFetchSchwabQuotes } = await import("../deskSchwabQuotes.js");
    const { quotes } = await deskFetchSchwabQuotes(["BRK.B"], "app2");
    const url = String(restFetch.mock.calls[0]?.[1]);
    expect(url).toContain("BRK%2FB");
    expect(quotes[0]?.symbol).toBe("BRK.B");
    expect(quotes[0]?.last).toBe(612.5);
  });
});