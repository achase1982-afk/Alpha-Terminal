import { describe, expect, it } from "vitest";
import { flowSessionClosed, takeFlowMetaUpdate, type FlowMetaState } from "../atFlowStream.js";

const CLOSED = [
  { feed: "live_gamma_0dte", status: "session_closed" },
  { feed: "uw_flow", status: "session_closed" },
  { feed: "schwab_streamer", status: "session_closed" },
];

const OPEN = [
  { feed: "live_gamma_0dte", status: "OK" },
  { feed: "uw_flow", status: "OK" },
  { feed: "schwab_streamer", status: "OK" },
];

describe("flow session meta", () => {
  const beforeOpen = Date.parse("2026-11-18T12:00:00.000Z");

  it("does not latch sessionClosed from the equity-options calendar", () => {
    expect(flowSessionClosed(OPEN, beforeOpen)).toBe(false);
    expect(flowSessionClosed(CLOSED, beforeOpen)).toBe(false);

    const state: FlowMetaState = { sessionClosed: null };
    const first = takeFlowMetaUpdate(state, "SPX", OPEN, beforeOpen);
    expect(first).toContain('"sessionClosed":false');
    expect(takeFlowMetaUpdate(state, "SPX", OPEN, beforeOpen)).toBeNull();
  });
});
