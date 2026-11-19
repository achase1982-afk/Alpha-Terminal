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
  it("sends closed at connect, then open when the session starts, without repeating", () => {
    const state: FlowMetaState = { sessionClosed: null };
    const first = takeFlowMetaUpdate(state, "SPX", CLOSED);
    expect(first).toContain('"sessionClosed":true');
    expect(flowSessionClosed(CLOSED)).toBe(true);
    expect(takeFlowMetaUpdate(state, "SPX", CLOSED)).toBeNull();

    const reopened = takeFlowMetaUpdate(state, "SPX", OPEN);
    expect(reopened).toContain('"sessionClosed":false');
    expect(flowSessionClosed(OPEN)).toBe(false);
    expect(takeFlowMetaUpdate(state, "SPX", OPEN)).toBeNull();
  });
});
