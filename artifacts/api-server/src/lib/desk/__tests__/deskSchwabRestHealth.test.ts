import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDeskHealthFeeds,
  deskResetFeedFreshnessForTests,
  deskSummarizeFeedsHealth,
} from "../deskFeedFreshness.js";
import { deskSchwabRestResolve } from "../deskSchwabRestCredential.js";
import { deskFetchSchwabChain } from "../deskSchwabChains.js";

const tokenStore = vi.hoisted(() => ({
  getBestAccessToken: vi.fn((): string | null => null),
  getSchwab2Token: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock("../deskSchwab2TokenStore.js", () => ({
  isSchwab2TokenStoreDead: () => false,
  hasSchwab2Tokens: () => Boolean(tokenStore.getSchwab2Token()),
  getSchwab2ValidAccessToken: () => tokenStore.getSchwab2Token(),
  deskSchwab2Configured: () => true,
}));

vi.mock("../../tokenStore.js", () => ({
  getBestAccessToken: () => tokenStore.getBestAccessToken(),
}));

describe("desk Schwab REST health labels", () => {
  beforeEach(() => {
    deskResetFeedFreshnessForTests();
    tokenStore.getBestAccessToken.mockReset();
    tokenStore.getBestAccessToken.mockReturnValue(null);
    tokenStore.getSchwab2Token.mockReset();
    tokenStore.getSchwab2Token.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    deskResetFeedFreshnessForTests();
  });

  it("no key-2 token: schwab2_rest stays not_authorized and any_failure is false", async () => {
    await deskSchwabRestResolve("app2");
    const feeds = buildDeskHealthFeeds();
    const schwab2 = feeds.find((f) => f.feed === "schwab2_rest");
    expect(schwab2?.status).toBe("not_authorized");
    expect(schwab2?.stale).toBe(false);
    expect(
      deskSummarizeFeedsHealth([{ feed: "schwab2_rest", status: schwab2!.status, stale: schwab2!.stale }])
        .any_failure,
    ).toBe(false);
  });

  it("successful chain on app1 credits schwab_chains with schwab source", async () => {
    tokenStore.getBestAccessToken.mockReturnValue("app1-token");
    const chainPayload = {
      callExpDateMap: { "2099-12-21": { "4000.0": [{ putCall: "CALL", symbol: "QQQ" }] } },
      putExpDateMap: {},
      underlyingPrice: 400,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(chainPayload), { status: 200 })),
    );
    await deskFetchSchwabChain("QQQ", "2099-12-21", {}, "app1");
    const feeds = buildDeskHealthFeeds();
    const chains = feeds.find((f) => f.feed === "schwab_chains");
    expect(chains?.status).toBe("OK");
    expect(chains?.source).toBe("schwab");
    expect(chains?.last_update_ts).not.toBeNull();
  });

  it("successful chain on app2 credits schwab_chains with schwab_rest_2 source", async () => {
    tokenStore.getSchwab2Token.mockResolvedValue("app2-token");
    const chainPayload = {
      callExpDateMap: { "2099-12-19": { "4000.0": [{ putCall: "CALL", symbol: "QQQ" }] } },
      putExpDateMap: {},
      underlyingPrice: 400,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(chainPayload), { status: 200 })),
    );
    await deskFetchSchwabChain("QQQ", "2099-12-19", {}, "app2");
    const feeds = buildDeskHealthFeeds();
    const chains = feeds.find((f) => f.feed === "schwab_chains");
    expect(chains?.status).toBe("OK");
    expect(chains?.source).toBe("schwab_rest_2");
    expect(chains?.last_update_ts).not.toBeNull();
  });

  it("chain fetch failure on key-1 marks schwab_chains, not schwab2_rest", async () => {
    tokenStore.getBestAccessToken.mockReturnValue("app1-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500, statusText: "Server Error" })),
    );
    await deskSchwabRestResolve("app2");
    await deskFetchSchwabChain("QQQ", "2099-12-20", {}, "app2");
    const feeds = buildDeskHealthFeeds();
    expect(feeds.find((f) => f.feed === "schwab2_rest")?.status).toBe("not_authorized");
    const chains = feeds.find((f) => f.feed === "schwab_chains");
    expect(chains?.status).toBe("error");
    expect(chains?.error).toBe("schwab_chain_fetch_failed");
  });
});
