import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDeskHealthFeeds,
  deskMarkFeedOnDemand,
  deskResetFeedFreshnessForTests,
  deskSummarizeFeedsHealth,
} from "../deskFeedFreshness.js";
import { deskApplyUwHttpFeedStatus } from "../addons/unusualWhales/deskUwStatus.js";

describe("deskFeedHealthGate UW optional feeds", () => {
  beforeEach(() => deskResetFeedFreshnessForTests());

  it("UW 402 leaves any_failure false", () => {
    deskApplyUwHttpFeedStatus("live_gamma", 402);
    const row = buildDeskHealthFeeds().find((f) => f.feed === "live_gamma")!;
    expect(row.status).toBe("expired_or_unpaid");
    const summary = deskSummarizeFeedsHealth([row]);
    expect(summary.any_failure).toBe(false);
    expect(summary.gated_feeds).toContain("live_gamma");
  });

  it("alphavantage on_demand is not counted in any_stale", () => {
    deskMarkFeedOnDemand("alphavantage", "alphavantage");
    const row = buildDeskHealthFeeds().find((f) => f.feed === "alphavantage")!;
    expect(row.status).toBe("on_demand");
    const summary = deskSummarizeFeedsHealth([row]);
    expect(summary.any_stale).toBe(false);
  });

  it("buildDeskHealthFeeds completes without awaiting UW network", () => {
    const t0 = Date.now();
    buildDeskHealthFeeds();
    deskSummarizeFeedsHealth(buildDeskHealthFeeds());
    expect(Date.now() - t0).toBeLessThan(50);
  });
});
