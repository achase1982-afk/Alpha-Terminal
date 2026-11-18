import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchSchwab = vi.fn();

vi.mock("../../lib/desk/deskSchwabQuotes.js", () => ({
  deskFetchSchwabQuotes: (...args: unknown[]) => fetchSchwab(...args),
}));

describe("deskV1 /quotes class-share symbology", () => {
  beforeEach(() => {
    process.env.DESK_API_KEY = "test-desk-secret";
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ?? "postgresql://localhost:5432/desk_test";
    fetchSchwab.mockReset();
    vi.resetModules();
  });

  it("echoes caller BRK.B and requests Schwab slash mapping via desk fetch", async () => {
    fetchSchwab.mockResolvedValue({
      quotes: [
        {
          symbol: "BRK.B",
          last: 612.5,
          bid: 612.4,
          ask: 612.6,
          bid_size: 1,
          ask_size: 1,
          volume: 1000,
          change: 1.2,
          change_pct: 0.2,
          quote_ts: Date.now(),
          trade_ts: Date.now(),
        },
      ],
      asOfMs: Date.now(),
      app: "app2",
      fellBack: false,
    });

    const deskRouter = (await import("../deskV1.js")).default;
    const app = express();
    app.use("/api/desk/v1", deskRouter);

    const res = await request(app)
      .get("/api/desk/v1/quotes?source=schwab&symbols=BRK.B")
      .set("Authorization", "Bearer test-desk-secret");

    expect(res.status).toBe(200);
    expect(res.body.quotes?.[0]?.symbol).toBe("BRK.B");
    expect(fetchSchwab.mock.calls[0]?.[0]).toEqual(["BRK.B"]);
  });
});