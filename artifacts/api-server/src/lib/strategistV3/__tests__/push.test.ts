import { describe, expect, it, vi, beforeEach } from "vitest";

const { findJobById, claimStrategistPushSend, sendPushToAll } = vi.hoisted(() => ({
  findJobById: vi.fn(),
  claimStrategistPushSend: vi.fn(),
  sendPushToAll: vi.fn(),
}));

vi.mock("../jobs.js", () => ({
  findJobById,
  claimStrategistPushSend,
}));

vi.mock("../../pushService.js", () => ({
  sendPushToAll,
}));

vi.mock("../../strategistNotifications.js", () => ({
  buildStrategistAnalyzeCompletionPush: (result: { status: string }, ticker: string) => ({
    notifyKind: "ready" as const,
    notifyMessage: `Strategist ready for ${ticker}`,
    pushTitle: `Strategist ready — ${ticker}`,
    pushBody: "Done",
  }),
  notifyStrategistCompletion: vi.fn(),
}));

import { fireStrategistJobPush } from "../push.js";

describe("fireStrategistJobPush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendPushToAll.mockResolvedValue(undefined);
  });

  it("skips push when job phase is still active (debating)", async () => {
    findJobById.mockResolvedValue({
      id: "job-1",
      status: "completed",
      phase: "debating",
      progress: {},
      checkpoint: { validating: { analyzeResult: { status: "recommendation" } } },
    });

    const sent = await fireStrategistJobPush({
      userId: "u1",
      jobId: "job-1",
      ticker: "AAPL",
      kind: "analyze",
    });

    expect(sent).toBe(false);
    expect(claimStrategistPushSend).not.toHaveBeenCalled();
    expect(sendPushToAll).not.toHaveBeenCalled();
  });

  it("skips duplicate push when pushSentAt already set", async () => {
    findJobById.mockResolvedValue({
      id: "job-1",
      status: "completed",
      phase: null,
      progress: { pushSentAt: "2026-05-27T12:00:00.000Z" },
      checkpoint: {},
    });

    const sent = await fireStrategistJobPush({
      userId: "u1",
      jobId: "job-1",
      ticker: "AAPL",
      kind: "analyze",
    });

    expect(sent).toBe(false);
    expect(claimStrategistPushSend).not.toHaveBeenCalled();
  });

  it("sends exactly one push after claim succeeds", async () => {
    findJobById.mockResolvedValue({
      id: "job-1",
      status: "completed",
      phase: null,
      progress: {},
      checkpoint: { validating: { analyzeResult: { status: "recommendation" } } },
    });
    claimStrategistPushSend.mockResolvedValue({
      id: "job-1",
      status: "completed",
      phase: null,
      checkpoint: { validating: { analyzeResult: { status: "recommendation" } } },
    });

    const sent = await fireStrategistJobPush({
      userId: "u1",
      jobId: "job-1",
      ticker: "AAPL",
      kind: "analyze",
    });

    expect(sent).toBe(true);
    expect(claimStrategistPushSend).toHaveBeenCalledTimes(1);
    expect(sendPushToAll).toHaveBeenCalledTimes(1);
  });
});
