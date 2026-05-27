import { describe, expect, it, beforeEach, vi } from "vitest";
import { applyThinkingPollResponse } from "./strategistPoller";
import { useTerminalStore } from "./store";

describe("applyThinkingPollResponse", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
      clear: () => storage.clear(),
      key: (i: number) => Array.from(storage.keys())[i] ?? null,
      get length() {
        return storage.size;
      },
    });
    useTerminalStore.setState({ strategistJobs: {} });
  });

  it("completes a job when the server payload is done even if local status is interrupted", () => {
    const jobId = "job-interrupted-test";
    useTerminalStore.getState().startStrategistJob(jobId, "HPE", { kind: "analyze" });
    useTerminalStore.setState((state) => ({
      strategistJobs: {
        ...state.strategistJobs,
        [jobId]: { ...state.strategistJobs[jobId]!, status: "interrupted" },
      },
    }));

    const outcome = applyThinkingPollResponse(jobId, {
      status: "Done",
      tokens: [],
      nextSince: 0,
      done: true,
      result: { status: "desk_recommendation", ticker: "HPE" },
      error: null,
    });

    expect(outcome).toBe("completed");
    expect(useTerminalStore.getState().strategistJobs[jobId]?.status).toBe("done");
  });

  it("advances lastServerProgressAt from serverProgressAt on partial polls", () => {
    const jobId = "job-server-progress";
    useTerminalStore.getState().startStrategistJob(jobId, "AAPL", { kind: "analyze" });
    const t0 = useTerminalStore.getState().strategistJobs[jobId]!.lastServerProgressAt;
    applyThinkingPollResponse(jobId, {
      status: "Thinking",
      tokens: [],
      nextSince: 0,
      done: false,
      result: null,
      error: null,
      serverProgressAt: t0 + 60_000,
    });
    expect(useTerminalStore.getState().strategistJobs[jobId]?.lastServerProgressAt).toBe(t0 + 60_000);
  });

  it("ignores incremental updates when the local job is not running", () => {
    const jobId = "job-done-skip-deltas";
    useTerminalStore.getState().startStrategistJob(jobId, "HPE", { kind: "analyze" });
    useTerminalStore.getState().completeStrategistJob(jobId, { status: "recommendation", ticker: "HPE" });

    const outcome = applyThinkingPollResponse(jobId, {
      status: "Searching the web…",
      tokens: ["partial"],
      nextSince: 99,
      done: false,
      result: null,
      error: null,
    });

    expect(outcome).toBe("completed");
    expect(useTerminalStore.getState().strategistJobs[jobId]?.tokens).toEqual([]);
    expect(useTerminalStore.getState().strategistJobs[jobId]?.nextSince).toBe(0);
  });
});
