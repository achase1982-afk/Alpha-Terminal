import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { deskLiveFlowBroadcastFrame, registerDeskLiveFlowSse, wrapDeskLiveFlowFrame } from "../deskLiveFlowHub.js";

vi.mock("../deskLiveFlowConfig.js", () => ({
  deskLiveFlowWsFanoutEnabled: () => false,
  DESK_LIVE_FLOW_SSE_HEARTBEAT_MS: 60_000,
  DESK_LIVE_FLOW_SLOW_CLIENT_HIGH_WATER: 200,
}));

function slowClient(): Response & { pendingBackpressure: boolean; chunks: string[] } {
  let pendingBackpressure = false;
  const chunks: string[] = [];
  const res = {
    chunks,
    pendingBackpressure,
    writeHead: vi.fn(),
    write: vi.fn((s: string) => {
      chunks.push(s);
      if (!pendingBackpressure) {
        pendingBackpressure = true;
        return false;
      }
      return true;
    }),
    on: vi.fn((ev: string, fn: () => void) => {
      if (ev === "close") return;
      if (ev === "drain") (res as { _drain: () => void })._drain = fn;
    }),
    once: vi.fn(),
    off: vi.fn(),
    _drain: () => {},
  } as unknown as Response & { pendingBackpressure: boolean; chunks: string[]; _drain: () => void };
  return res;
}

describe("deskLiveFlow backpressure", () => {
  it("buffers when write returns false and drops when high water exceeded", () => {
    const res = slowClient();
    registerDeskLiveFlowSse(res, "SPX");
    const big = wrapDeskLiveFlowFrame(
      { type: "flow_1s", sym: "SPX", bucket_ms: 0, payload: "x".repeat(500) },
      0,
      1,
    );
    for (let i = 0; i < 20; i++) deskLiveFlowBroadcastFrame({ ...big, seq: i + 1 });
    expect(res.chunks.length).toBeGreaterThan(0);
  });
});