import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/desk/deskLiveFlowHub.js", () => ({
  registerDeskLiveFlowSse: (res: { status: (n: number) => { end: () => void } }) => {
    res.status(200).end();
  },
  deskLiveFlowSseClientCount: () => 0,
}));

describe("deskV1 GET /stream/flow class-share", () => {
  beforeEach(() => {
    process.env.DESK_API_KEY = "test-desk-secret";
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ?? "postgresql://localhost:5432/desk_test";
    vi.resetModules();
  });

  it("does not reject BRK/B with invalid_symbol", async () => {
    const deskRouter = (await import("../deskV1.js")).default;
    const app = express();
    app.use("/api/desk/v1", deskRouter);
    const res = await request(app)
      .get("/api/desk/v1/stream/flow")
      .query({ symbol: "BRK/B" })
      .set("Authorization", "Bearer test-desk-secret");
    expect(res.status).not.toBe(400);
    expect(res.body?.error).not.toBe("invalid_symbol");
  });
});