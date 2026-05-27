import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  requireStrategistUserId: vi.fn(),
}));

vi.mock("../../lib/strategistAuth.js", () => ({
  requireStrategistUserId: mocks.requireStrategistUserId,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      select: mocks.dbSelect,
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock("../../lib/strategistClientSanitize.js", () => ({
  stripHistoryCardJsonForClient: (x: unknown) => x,
}));

import express from "express";
import request from "supertest";
import strategistV2Routes from "../strategistV2.js";

function buildApp() {
  const app = express();
  app.use("/strategist", strategistV2Routes);
  return app;
}

describe("GET /strategist/history user scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireStrategistUserId.mockReturnValue("user-scoped");
  });

  it("joins strategist_jobs and filters by user id", async () => {
    const limit = vi.fn().mockResolvedValue([
      {
        id: 1,
        jobId: "job-1",
        ticker: "AAPL",
        cardJson: { status: "recommendation" },
        cleared: false,
        clearedAt: null,
        createdAt: new Date(),
      },
    ]);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const innerJoin = vi.fn(() => ({ where }));
    const from = vi.fn(() => ({ innerJoin }));
    mocks.dbSelect.mockReturnValue({ from });

    const res = await request(buildApp()).get("/strategist/history");

    expect(res.status).toBe(200);
    expect(innerJoin).toHaveBeenCalled();
    expect(where).toHaveBeenCalled();
    expect(res.body).toHaveLength(1);
  });

  it("returns 401 without auth user", async () => {
    mocks.requireStrategistUserId.mockReturnValue(null);
    const res = await request(buildApp()).get("/strategist/history");
    expect(res.status).toBe(401);
  });
});
