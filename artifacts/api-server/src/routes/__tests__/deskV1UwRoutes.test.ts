import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/desk/addons/unusualWhales/deskUwLiveFeeds.js", () => ({
  refreshDeskUwLiveFeeds: () => new Promise(() => {}),
}));

describe("deskV1 UW routes", () => {
  beforeEach(() => {
    process.env.DESK_API_KEY = "test-desk-secret";
    process.env.UW_API_KEY = "uw-test";
    vi.resetModules();
  });

  it("GET /health returns quickly while UW poll refresh hangs", async () => {
    const { runDeskUwPollCycle } = await import(
      "../../lib/desk/addons/unusualWhales/deskUwPoller.js"
    );
    void runDeskUwPollCycle();
    const deskRouter = (await import("../deskV1.js")).default;
    const app = express();
    app.use("/api/desk/v1", deskRouter);
    const t0 = Date.now();
    const res = await request(app)
      .get("/api/desk/v1/health")
      .set("Authorization", "Bearer test-desk-secret");
    expect(res.status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(300);
  });

  it("GET /flow?symbol=SPX prefers dedicated SPX poll cache over __all__", async () => {
    const { deskSeedUwFlowCacheForTests, deskSeedUwFlowSpxCacheForTests } = await import(
      "../../lib/desk/addons/unusualWhales/index.js"
    );
    deskSeedUwFlowCacheForTests([{ ticker: "QQQ", premium: 2 }]);
    deskSeedUwFlowSpxCacheForTests([{ ticker: "SPX", premium: 1 }]);
    const deskRouter = (await import("../deskV1.js")).default;
    const app = express();
    app.use("/api/desk/v1", deskRouter);
    const res = await request(app)
      .get("/api/desk/v1/flow?symbol=SPX&source=unusual_whales")
      .set("Authorization", "Bearer test-desk-secret");
    expect(res.status).toBe(200);
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.symbol).toBe("SPX");
  });
});
