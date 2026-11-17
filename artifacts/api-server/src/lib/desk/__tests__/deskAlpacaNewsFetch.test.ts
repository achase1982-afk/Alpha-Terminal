import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("requests batched symbols with 24h start and auth headers", async () => {
    const { deskFetchAlpacaNews } = await import("../deskAlpacaNews.js");
    const r = await deskFetchAlpacaNews(["SPY", "SPX"]);
    expect(r.ok).toBe(true);
    expect(r.articles).toHaveLength(1);
    expect(r.asOfMs).toBe(Date.parse("2026-11-17T14:00:00Z"));
  });
});