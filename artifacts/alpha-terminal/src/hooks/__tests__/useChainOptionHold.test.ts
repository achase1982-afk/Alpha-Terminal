/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useChainOptionHold } from "../useChainOptionHold";
import { createOptionHoldTestHarness, HOLD_TEST_CLIENT_ID } from "./optionHoldTestHarness";
import * as streamClientId from "@/lib/streamClientId";

describe("useChainOptionHold", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(streamClientId, "getStreamClientId").mockReturnValue(HOLD_TEST_CLIENT_ID);
  });

  it("does not re-subscribe when only underlying spot ticks", async () => {
    const harness = createOptionHoldTestHarness();
    const holdSig = "chain:SPY:abc123\nSPY   251121C00600000";
    const keys = ["SPY   251121C00600000"];
    const viewId = "chain:SPY:abc123";

    const { rerender } = renderHook(
      ({ spot }) =>
        useChainOptionHold(holdSig, keys, viewId, harness, spot),
      { initialProps: { spot: 600 as number | null } },
    );

    await waitFor(() => expect(harness.server.size).toBe(1));
    for (let i = 0; i < 30; i++) {
      rerender({ spot: 600 + i * 0.1 });
    }
    expect(harness.server.size).toBe(1);
  });

  it("holdSig A to B with same viewId keeps hold with B keys", async () => {
    const harness = createOptionHoldTestHarness();
    const viewId = "chain:SPY:fixed";
    const id = harness.holderId("chain", viewId);

    const { rerender } = renderHook(
      ({ sig, keys }) => useChainOptionHold(sig, keys, viewId, harness, 600),
      { initialProps: { sig: "chain:SPY:fixed\nK-A", keys: ["K-A"] } },
    );

    await waitFor(() => expect(harness.server.get(id)).toEqual(["K-A"]));
    rerender({ sig: "chain:SPY:fixed\nK-B", keys: ["K-B"] });
    await harness.drain();
    expect(harness.server.size).toBe(1);
    expect(harness.server.get(id)).toEqual(["K-B"]);
  });

  it("final unmount after POST resolves leaves server empty", async () => {
    const harness = createOptionHoldTestHarness();
    const viewId = "chain:SPY:unmount1";

    const { unmount } = renderHook(() =>
      useChainOptionHold("chain:SPY:unmount1\nK1", ["K1"], viewId, harness, 600),
    );

    await waitFor(() => expect(harness.server.size).toBe(1));
    unmount();
    await harness.drain();
    expect(harness.server.size).toBe(0);
  });

  it("unmount before POST resolves leaves server empty", async () => {
    const harness = createOptionHoldTestHarness({ postDelayMs: 50 });
    const viewId = "chain:SPY:unmount2";

    const { unmount } = renderHook(() =>
      useChainOptionHold("chain:SPY:unmount2\nK1", ["K1"], viewId, harness, 600),
    );

    unmount();
    await harness.drain();
    expect(harness.server.size).toBe(0);
  });
});
