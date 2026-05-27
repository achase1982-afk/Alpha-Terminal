import { describe, expect, it } from "vitest";
import {
  persistedFinalPayloadFromHistoryRow,
  runningPayloadFromJob,
  terminalNonSuccessPayload,
} from "../pollPayload.js";
import type { StrategistJob } from "@workspace/db";

function baseJob(overrides: Partial<StrategistJob> = {}): StrategistJob {
  return {
    id: "job-1",
    userId: "user-1",
    kind: "analyze",
    ticker: "AAPL",
    params: {},
    status: "running",
    phase: "analyzing",
    lastCompletedPhase: null,
    progress: { liveStatus: "Running…", tokens: ["a", "b"], transcript: [] },
    checkpoint: {},
    resultHistoryId: null,
    error: null,
    priority: 0,
    attempt: 1,
    workerId: "w1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    startedAt: new Date("2026-01-01T00:00:01Z"),
    lastHeartbeatAt: new Date("2026-01-01T00:00:02Z"),
    completedAt: null,
    ...overrides,
  };
}

describe("resolveStrategistPollPayload shapes", () => {
  it("running payload slices tokens by since", () => {
    const payload = runningPayloadFromJob(baseJob(), 1);
    expect(payload.done).toBe(false);
    expect(payload.tokens).toEqual(["b"]);
    expect(payload.nextSince).toBe(2);
    expect(payload.validationMeta).toBeNull();
  });

  it("persisted final payload matches V2 terminal shape", () => {
    const payload = persistedFinalPayloadFromHistoryRow("job-1", {
      ticker: "AAPL",
      createdAt: new Date("2026-01-01T00:05:00Z"),
      cardJson: { status: "recommendation", ticker: "AAPL" },
    });
    expect(payload.done).toBe(true);
    expect(payload.tokens).toEqual([]);
    expect(payload.nextSince).toBe(0);
    expect(payload.source).toBe("persisted");
    expect(payload.validationMeta).toBeNull();
  });

  it("cancelled terminal payload", () => {
    const payload = terminalNonSuccessPayload(
      baseJob({ status: "cancelled", completedAt: new Date("2026-01-01T00:06:00Z") }),
      0,
    );
    expect(payload.done).toBe(true);
    expect(payload.cancelled).toBe(true);
    expect(payload.error).toBeNull();
  });

  it("failed terminal payload uses sanitized error string", () => {
    const payload = terminalNonSuccessPayload(
      baseJob({ status: "failed", completedAt: new Date("2026-01-01T00:06:00Z") }),
      0,
    );
    expect(payload.done).toBe(true);
    expect(payload.error).toBe("Analysis failed. Please retry.");
  });
});
