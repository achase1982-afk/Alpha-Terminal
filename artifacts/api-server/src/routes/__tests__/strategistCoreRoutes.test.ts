import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelJob: vi.fn(),
  findJobById: vi.fn(),
  requireStrategistUserId: vi.fn(),
  isStrategistV3Enabled: vi.fn(() => true),
}));

vi.mock("../../lib/strategistAuth.js", () => ({
  requireStrategistUserId: mocks.requireStrategistUserId,
}));

vi.mock("../../lib/strategistV3/config.js", () => ({
  isStrategistV3Enabled: mocks.isStrategistV3Enabled,
}));

vi.mock("../../lib/strategistV3/jobs.js", () => ({
  cancelJob: mocks.cancelJob,
  findJobById: mocks.findJobById,
  findActiveDuplicate: vi.fn(),
  insertQueuedJob: vi.fn(),
  listActiveJobsForUser: vi.fn(),
}));

vi.mock("../../lib/strategistV3/resolvePoll.js", () => ({
  resolveStrategistPollPayload: vi.fn(),
}));

vi.mock("../../lib/strategistAnalyzeCancellation.js", () => ({
  markStrategistAnalyzeCancelled: vi.fn(),
}));

import express from "express";
import request from "supertest";
import strategistCoreRoutes from "../strategistCoreRoutes.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/strategist", strategistCoreRoutes);
  return app;
}

describe("POST /strategist/validate-trade/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireStrategistUserId.mockReturnValue("user-1");
  });

  it("cancels a running validate_trade job for the owner", async () => {
    mocks.findJobById.mockResolvedValue({
      id: "job-v1",
      userId: "user-1",
      kind: "validate_trade",
      status: "running",
    });
    mocks.cancelJob.mockResolvedValue({ id: "job-v1", status: "cancelled" });

    const res = await request(buildApp())
      .post("/strategist/validate-trade/cancel")
      .send({ jobId: "job-v1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mocks.cancelJob).toHaveBeenCalledWith("job-v1");
  });

  it("rejects cancel for analyze jobs", async () => {
    mocks.findJobById.mockResolvedValue({
      id: "job-a1",
      userId: "user-1",
      kind: "analyze",
      status: "running",
    });

    const res = await request(buildApp())
      .post("/strategist/validate-trade/cancel")
      .send({ jobId: "job-a1" });

    expect(res.status).toBe(404);
    expect(mocks.cancelJob).not.toHaveBeenCalled();
  });
});
