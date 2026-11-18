import express from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../lib/desk/deskSchwabBars.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/desk/deskSchwabBars.js")>();
  return {
    ...actual,
    deskFetchSchwabBars: vi.fn(async () => ({
      bars: [{ ts: "2010-01-04T00:00:00.000Z", open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }],
      asOfMs: 1_262_304_000_000,
      app: "app2" as const,
      fellBack: false,
    })),
  };
});

describe("GET /api/desk/v1/bars (schwab range)", () => {
  beforeEach(() => {
    process.env.DESK_API_KEY = "test-desk-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://localhost:5432/desk_test";
    vi.resetModules();
  });

  it("forwards start/end to deskFetchSchwabBars", async () => {
    const { deskFetchSchwabBars } = await import("../../lib/desk/deskSchwabBars.js");
    const { default: deskRouter } = await import("../deskV1.js");
    const app = express();
    app.use("/api/desk/v1", deskRouter);

    const res = await request(app)
      .get("/api/desk/v1/bars")
      .query({ source: "schwab", symbol: "$SPX", timeframe: "1d", start: "2010-01-01", limit: "5000" })
      .set("Authorization", "Bearer test-desk-secret");

    expect(res.status).toBe(200);
    expect(deskFetchSchwabBars).toHaveBeenCalled();
    const call = vi.mocked(deskFetchSchwabBars).mock.calls.at(-1);
    expect(call?.[0]).toBe("$SPX");
    expect(call?.[2]).toBe(500);
    expect(call?.[4]?.startMs).toBe(Date.parse("2010-01-01T00:00:00-05:00"));
  });

  it("rejects invalid start", async () => {
    const { default: deskRouter } = await import("../deskV1.js");
    const app = express();
    app.use("/api/desk/v1", deskRouter);
    const res = await request(app)
      .get("/api/desk/v1/bars")
      .query({ source: "schwab", start: "not-a-date" })
      .set("Authorization", "Bearer test-desk-secret");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_start");
  });
});