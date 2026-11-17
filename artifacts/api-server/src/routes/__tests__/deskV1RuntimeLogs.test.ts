import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryTelemetryEvents } = vi.hoisted(() => ({
  queryTelemetryEvents: vi.fn().mockResolvedValue([
    {
      id: "1",
      emittedAt: new Date().toISOString(),
      service: "server",
      system: "HTTP",
      level: "ERROR",
      message: "test",
      subsystem: null,
      details: {},
    },
  ]),
}));

vi.mock("../../lib/telemetryEventsDb.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/telemetryEventsDb.js")>();
  return {
    ...actual,
    queryTelemetryEvents,
  };
});

describe("deskV1 GET /runtime-logs", () => {
  beforeEach(() => {
    process.env.DESK_API_KEY = "test-desk-secret";
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ?? "postgresql://localhost:5432/desk_test";
    queryTelemetryEvents.mockClear();
  });

  it("returns 401 without bearer key", async () => {
    const deskRouter = (await import("../deskV1.js")).default;
    const app = express();
    app.use("/api/desk/v1", deskRouter);
    const res = await request(app).get("/api/desk/v1/runtime-logs");
    expect(res.status).toBe(401);
  });

  it("returns 200 with bearer key and applies default levels", async () => {
    const deskRouter = (await import("../deskV1.js")).default;
    const app = express();
    app.use("/api/desk/v1", deskRouter);
    const res = await request(app)
      .get("/api/desk/v1/runtime-logs?minutes=5&limit=10")
      .set("Authorization", "Bearer test-desk-secret");
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(queryTelemetryEvents).toHaveBeenCalled();
    const arg = queryTelemetryEvents.mock.calls[0]?.[0] as { levels?: string[] };
    expect(arg.levels).toEqual(["ERROR", "WARN"]);
  });
});