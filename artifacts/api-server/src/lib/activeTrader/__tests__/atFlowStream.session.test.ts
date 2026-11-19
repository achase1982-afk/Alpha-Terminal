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
  const duringGap = Date.parse("2026-11-18T14:27:00.000Z");

  it("follows the options session and ignores a cash-window session_closed row", () => {
    const state: FlowMetaState = { sessionClosed: null };
    const first = takeFlowMetaUpdate(state, "SPX", OPEN, beforeOpen);
    expect(first).toContain('"sessionClosed":true');
    expect(flowSessionClosed(OPEN, beforeOpen)).toBe(true);
    expect(takeFlowMetaUpdate(state, "SPX", OPEN, beforeOpen)).toBeNull();

    const reopened = takeFlowMetaUpdate(state, "SPX", CLOSED, duringGap);
    expect(reopened).toContain('"sessionClosed":false');
    expect(flowSessionClosed(CLOSED, duringGap)).toBe(false);
    expect(takeFlowMetaUpdate(state, "SPX", CLOSED, duringGap)).toBeNull();
  });
});
