import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Response } from "express";
import {
  deskLiveFlowBroadcastFrame,
  deskLiveFlowResetSeqForTests,
  registerDeskLiveFlowSse,
  wrapDeskLiveFlowFrame,
} from "../deskLiveFlowHub.js";

vi.mock("../deskLiveFlowConfig.js", () => ({
  deskLiveFlowWsFanoutEnabled: () => false,
  DESK_LIVE_FLOW_SSE_HEARTBEAT_MS: 60_000,
  DESK_LIVE_FLOW_SLOW_CLIENT_HIGH_WATER: 1024,
}));

function mockRes(): Response & { chunks: string[]; drain?: () => void } {
  const chunks: string[] = [];
  const res = {
    chunks,
    writeHead: vi.fn(),
    write: vi.fn((s: string) => {
      chunks.push(s);
      return true;
    }),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
  } as unknown as Response & { chunks: string[] };
  return res;
}

describe("deskLiveFlow SSE framing", () => {
  beforeEach(() => {
    deskLiveFlowResetSeqForTests();
  });

  it("writes SSE data lines with JSON payload", () => {
    const res = mockRes();
    registerDeskLiveFlowSse(res, "SPX");
    expect(res.writeHead).toHaveBeenCalled();
    expect(res.chunks.some((c) => c.includes(": connected"))).toBe(true);

    const frame = wrapDeskLiveFlowFrame({ type: "px", sym: "$SPX", last: 1, bid: 1, ask: 2 }, 1, 2);
    deskLiveFlowBroadcastFrame(frame);
    expect(res.chunks.some((c) => c.startsWith("data: ") && c.includes('"type":"px"'))).toBe(true);
    expect(frame.seq).toBe(1);
  });

  it("includes seq on successive frames", () => {
    const a = wrapDeskLiveFlowFrame({ type: "flow_1s", sym: "SPX", bucket_ms: 0 }, 0, 1);
    const b = wrapDeskLiveFlowFrame({ type: "flow_1s", sym: "SPX", bucket_ms: 1000 }, 1000, 1001);
    expect(b.seq).toBe(a.seq + 1);
  });
});