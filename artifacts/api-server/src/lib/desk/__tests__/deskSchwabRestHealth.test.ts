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
}));

vi.mock("../deskSchwab2TokenStore.js", () => ({
  isSchwab2TokenStoreDead: () => false,
  hasSchwab2Tokens: () => false,
  getSchwab2ValidAccessToken: async () => null,
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

  it("chain fetch failure on key-1 marks schwab_chains, not schwab2_rest", async () => {
    tokenStore.getBestAccessToken.mockReturnValue("app1-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500, statusText: "Server Error" })),
    );
    await deskSchwabRestResolve("app2");
    await deskFetchSchwabChain("QQQ", "2099-12-19", {}, "app2");
    const feeds = buildDeskHealthFeeds();
    expect(feeds.find((f) => f.feed === "schwab2_rest")?.status).toBe("not_authorized");
    const chains = feeds.find((f) => f.feed === "schwab_chains");
    expect(chains?.status).toBe("error");
    expect(chains?.error).toBe("schwab_chain_fetch_failed");
  });
});
