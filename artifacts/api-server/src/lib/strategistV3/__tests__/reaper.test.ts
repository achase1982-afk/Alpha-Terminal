import { describe, expect, it, vi } from "vitest";
import type { StrategistJob } from "@workspace/db";
import { handleStaleRunningJob } from "../jobs.js";

function baseJob(overrides: Partial<StrategistJob> = {}): StrategistJob {
  return {
    id: "stale-1",
    userId: "u1",
    kind: "analyze",
    ticker: "AAPL",
    params: {},
    status: "running",
    phase: "debating",
    lastCompletedPhase: "analyzing",
    progress: {},
    checkpoint: {},
    resultHistoryId: null,
    error: null,
    priority: 0,
    attempt: 3,
    workerId: "w1",
    createdAt: new Date(),
    startedAt: new Date(),
    lastHeartbeatAt: new Date(Date.now() - 120_000),
    completedAt: null,
    ...overrides,
  };
}

describe("handleStaleRunningJob", () => {
  it("marks terminal stale jobs failed via markJobFailed (push)", async () => {
    const markFailed = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn();

    const outcome = await handleStaleRunningJob(baseJob(), { markFailed, release });

    expect(outcome).toBe("failed");
    expect(markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ id: "stale-1" }),
      expect.objectContaining({ code: "worker_crashed" }),
    );
    expect(release).not.toHaveBeenCalled();
  });

  it("requeues when attempt < 3 and checkpoint exists", async () => {
    const markFailed = vi.fn();
    const release = vi.fn().mockResolvedValue(undefined);

    const outcome = await handleStaleRunningJob(
      baseJob({ id: "stale-2", attempt: 1, lastCompletedPhase: "preparing_iv" }),
      { markFailed, release },
    );

    expect(outcome).toBe("released");
    expect(release).toHaveBeenCalledWith("stale-2");
    expect(markFailed).not.toHaveBeenCalled();
  });
});
