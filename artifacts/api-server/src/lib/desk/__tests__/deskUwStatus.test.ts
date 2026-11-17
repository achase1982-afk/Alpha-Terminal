import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDeskHealthFeeds,
  deskResetFeedFreshnessForTests,
} from "../deskFeedFreshness.js";
import { deskApplyUwHttpFeedStatus, deskUwRouteHttpFromStatus } from "../deskUwStatus.js";

describe("deskUwStatus", () => {
  beforeEach(() => deskResetFeedFreshnessForTests());

  for (const [status, healthStatus] of [
    [401, "auth_error"],
    [403, "auth_error"],
    [402, "expired_or_unpaid"],
    [429, "rate_limited"],
  ] as const) {
    it(`maps UW HTTP ${status} to health ${healthStatus}`, () => {
      deskApplyUwHttpFeedStatus("live_gamma", status);
      const row = buildDeskHealthFeeds().find((f) => f.feed === "live_gamma");
      expect(row?.status).toBe(healthStatus);
      const route = deskUwRouteHttpFromStatus(status);
      expect(route.httpStatus).toBe(503);
    });
  }

  it("route mapping never returns 500", () => {
    expect(deskUwRouteHttpFromStatus(500).httpStatus).toBe(503);
    expect(deskUwRouteHttpFromStatus(0).httpStatus).toBe(503);
  });
});