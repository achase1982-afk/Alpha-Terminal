import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseAlpacaNewsPayload } from "../deskAlpacaNews.js";
import { buildDeskHealthFeeds, deskResetFeedFreshnessForTests } from "../deskFeedFreshness.js";

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

  it("recovers alpaca feed health after HTTP 500 then success", async () => {
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
    const { deskFetchAlpacaNews } = await import("../deskAlpacaNews.js");
    await deskFetchAlpacaNews(["SPY"]);
    const afterFail = buildDeskHealthFeeds(now).find((f) => f.feed === "alpaca");
    expect(afterFail?.status).toBe("error");
    await deskFetchAlpacaNews(["SPY"]);
    const afterOk = buildDeskHealthFeeds(now).find((f) => f.feed === "alpaca");
    expect(afterOk?.status).toBe("OK");
    expect(afterOk?.error).toBeUndefined();
    vi.useRealTimers();
  });

  it("parseAlpacaNewsPayload fails shape without news array", () => {
    expect(parseAlpacaNewsPayload({ items: [] })).toHaveLength(0);
    expect(parseAlpacaNewsPayload(fixture())).not.toHaveLength(0);
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
    const { deskFetchAlpacaNews } = await import("../deskAlpacaNews.js");
    await deskFetchAlpacaNews(["SPY"]);
    const row = buildDeskHealthFeeds(now).find((f) => f.feed === "alpaca");
    expect(row?.status).toBe("ok_no_new_articles");
    expect(row?.stale).toBe(false);
  });
});
