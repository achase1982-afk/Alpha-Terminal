import { describe, expect, it } from "vitest";
import { reduceFlowSessionClosed } from "../deskFlowSession";

describe("flow session latch", () => {
  it("clears a closed label when a later meta says the session is open", () => {
    let closed = reduceFlowSessionClosed(false, { sessionClosed: true });
    expect(closed).toBe(true);
    closed = reduceFlowSessionClosed(closed, {});
    expect(closed).toBe(true);
    closed = reduceFlowSessionClosed(closed, null);
    expect(closed).toBe(true);
    closed = reduceFlowSessionClosed(closed, { sessionClosed: false });
    expect(closed).toBe(false);
  });
});
