/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useTicketOptionHold } from "../useTicketOptionHold";
import { createOptionHoldTestHarness, HOLD_TEST_CLIENT_ID } from "./optionHoldTestHarness";
import * as streamClientId from "@/lib/streamClientId";

describe("useTicketOptionHold", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(streamClientId, "getStreamClientId").mockReturnValue(HOLD_TEST_CLIENT_ID);
  });

  it("open close reopen yields server counts 1 then 0 then 1", async () => {
    const harness = createOptionHoldTestHarness();
    const holdSig = "ticket:SPY:abc\nLEG1";
    const keys = ["LEG1"];
    const viewId = "ticket:SPY:abc";

    const { rerender } = renderHook(
      ({ open }) => useTicketOptionHold(open, holdSig, viewId, keys, harness),
      { initialProps: { open: true } },
    );

    await waitFor(() => expect(harness.server.size).toBe(1));
    rerender({ open: false });
    await harness.drain();
    expect(harness.server.size).toBe(0);
    rerender({ open: true });
    await waitFor(() => expect(harness.server.size).toBe(1));
  });

  it("unmount while open leaves server empty", async () => {
    const harness = createOptionHoldTestHarness();
    const { unmount } = renderHook(() =>
      useTicketOptionHold(true, "ticket:SPY:x\nL", "ticket:SPY:x", ["L"], harness),
    );

    await waitFor(() => expect(harness.server.size).toBe(1));
    unmount();
    await harness.drain();
    expect(harness.server.size).toBe(0);
  });

  it("new legs array identity with same holdSig makes no subscribe churn", async () => {
    const harness = createOptionHoldTestHarness();
    const holdSig = "ticket:QQQ:x\nSYM";
    const viewId = "ticket:QQQ:x";
    let subscribeCalls = 0;
    const orig = harness.subscribeOptionSymbols!;
    harness.subscribeOptionSymbols = async (...args) => {
      subscribeCalls++;
      return orig(...args);
    };

    const { rerender } = renderHook(
      ({ keys }) => useTicketOptionHold(true, holdSig, viewId, keys, harness),
      { initialProps: { keys: ["SYM"] } },
    );

    await waitFor(() => expect(subscribeCalls).toBe(1));
    rerender({ keys: ["SYM"] });
    await harness.drain();
    expect(subscribeCalls).toBe(1);
    expect(harness.server.size).toBe(1);
  });

  it("switching legs moves the hold payload", async () => {
    const harness = createOptionHoldTestHarness();
    const viewId = "ticket:SPY:legs";
    const id = harness.holderId("ticket", viewId);

    const { rerender } = renderHook(
      ({ sig, keys }) => useTicketOptionHold(true, sig, viewId, keys, harness),
      { initialProps: { sig: "ticket:SPY:legs\nLEG-A", keys: ["LEG-A"] } },
    );

    await waitFor(() => expect(harness.server.get(id)).toEqual(["LEG-A"]));
    rerender({ sig: "ticket:SPY:legs\nLEG-B", keys: ["LEG-B"] });
    await harness.drain();
    expect(harness.server.size).toBe(1);
    expect(harness.server.get(id)).toEqual(["LEG-B"]);
  });
});