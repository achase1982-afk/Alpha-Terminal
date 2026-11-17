import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseAlpacaNewsPayload } from "../deskAlpacaNews.js";
import {
  buildDeskHealthFeeds,
  deskResetFeedFreshnessForTests,
  deskTouchFeedArticleAge,
  deskTouchFeedPollOk,
} from "../deskFeedFreshness.js";
import { deskEnvelope } from "../deskEnvelope.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = () =>
  JSON.parse(readFileSync(join(here, "fixtures", "alpaca-news.json"), "utf8")) as unknown;

vi.mock("../deskAlpaca.js", () => ({
  getAlpacaKeys: () => ({ keyId: "id", secret: "sec" }),
}));

vi.mock("../deskAlpacaPaper.js", () => ({
  getAlpacaPaperKeys: () => ({ keyId: "", secret: "" }),
}));

describe("deskFetchAlpacaNews", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toContain("v1beta1/news");
        expect(url).toContain("sort=desc");
        expect(url).toContain("start=");
        expect(init?.headers).toMatchObject({
          "APCA-API-KEY-ID": "id",
          "APCA-API-SECRET-KEY": "sec",
        });
        return new Response(JSON.stringify(fixture()), { status: 200 });
      }),
    );
  });

  it("requests batched symbols with auth headers and parses v1beta1 news key", async () => {
    expect(parseAlpacaNewsPayload(fixture())).toHaveLength(1);
    const { deskFetchAlpacaNews } = await import("../deskAlpacaNews.js");
    const r = await deskFetchAlpacaNews(["SPY", "SPX"]);
    expect(r.ok).toBe(true);
    expect(r.articles).toHaveLength(1);
  });

  it("on-demand empty response does not clear alpaca article freshness", async () => {
    const now = Date.now();
    const articleMs = now - 4 * 60 * 60 * 1000;
    deskResetFeedFreshnessForTests();
    deskTouchFeedPollOk("alpaca", now, "alpaca_news");
    deskTouchFeedArticleAge("alpaca", articleMs, "alpaca_news");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ news: [] }), { status: 200 })),
    );
    const { deskFetchAlpacaNews } = await import("../deskAlpacaNews.js");
    const r = await deskFetchAlpacaNews(["SPY"]);
    expect(r.ok).toBe(true);
    expect(r.articles).toHaveLength(0);
    const row = buildDeskHealthFeeds(now).find((f) => f.feed === "alpaca");
    expect(row?.last_update_ts).toBe(articleMs);
    expect(row?.status).toBe("ok_no_new_articles");
  });

  it("recovers alpaca feed health after HTTP 500 then success (background probe only)", async () => {
    vi.useFakeTimers();
    const now = Date.parse("2026-11-17T18:00:00.000Z");
    vi.setSystemTime(now);
    deskResetFeedFreshnessForTests();
    const freshPayload = {
      news: [
        {
          id: 1,
          headline: "Desk fixture headline",
          created_at: new Date(now - 60_000).toISOString(),
          symbols: ["SPY"],
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("err", { status: 500 }))
      .mockImplementation(async (url: string) => {
        expect(url).toContain("v1beta1/news");
        return new Response(JSON.stringify(freshPayload), { status: 200 });
      });
    vi.stubGlobal("fetch", fetchMock);
    const { deskProbeAlpacaNews } = await import("../deskAlpacaNews.js");
    await deskProbeAlpacaNews();
    const afterFail = buildDeskHealthFeeds(now).find((f) => f.feed === "alpaca");
    expect(afterFail?.status).toBe("error");
    await deskProbeAlpacaNews();
    const afterOk = buildDeskHealthFeeds(now).find((f) => f.feed === "alpaca");
    expect(afterOk?.status).toBe("OK");
    expect(afterOk?.error).toBeUndefined();
    vi.useRealTimers();
  });

  it("parseAlpacaNewsPayload fails shape without news array", () => {
    expect(parseAlpacaNewsPayload({ items: [] })).toHaveLength(0);
    expect(parseAlpacaNewsPayload(fixture())).not.toHaveLength(0);
  });

  it("on-demand as_of is poll time, not newest article time", async () => {
    vi.useFakeTimers();
    const pollMs = Date.parse("2026-06-02T14:00:00.000Z");
    vi.setSystemTime(pollMs);
    const articleMs = pollMs - 4 * 60 * 60 * 1000;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            news: [
              {
                id: 1,
                headline: "old",
                created_at: new Date(articleMs).toISOString(),
                symbols: ["SPY"],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const { deskFetchAlpacaNews } = await import("../deskAlpacaNews.js");
    const r = await deskFetchAlpacaNews(["SPY"]);
    expect(r.asOfMs).toBe(pollMs);
    deskResetFeedFreshnessForTests();
    deskTouchFeedPollOk("alpaca", pollMs, "alpaca_news");
    deskTouchFeedArticleAge("alpaca", articleMs, "alpaca_news");
    const env = deskEnvelope({ articles: r.articles }, "alpaca_news", r.asOfMs, "alpaca");
    expect(env.stale).toBe(false);
    vi.useRealTimers();
  });

  it("fresh poll with 4h-old articles yields ok_no_new_articles", async () => {
    const now = Date.now();
    const articleMs = now - 4 * 60 * 60 * 1000;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            news: [
              {
                id: 1,
                headline: "stale headline",
                created_at: new Date(articleMs).toISOString(),
                symbols: ["SPY"],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    deskResetFeedFreshnessForTests();
    const { deskProbeAlpacaNews } = await import("../deskAlpacaNews.js");
    await deskProbeAlpacaNews();
    const row = buildDeskHealthFeeds(now).find((f) => f.feed === "alpaca");
    expect(row?.status).toBe("ok_no_new_articles");
    expect(row?.stale).toBe(false);
  });
});
