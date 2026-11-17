/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useChainOptionHold } from "../useChainOptionHold";

describe("useChainOptionHold", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not re-subscribe when only underlying spot ticks", async () => {
    const subscribe = vi.fn().mockResolvedValue("holder-1");
    const release = vi.fn().mockResolvedValue(undefined);
    const holdSig = "chain:SPY:abc123\nSPY   251121C00600000";
    const keys = ["SPY   251121C00600000"];
    const viewId = "chain:SPY:abc123";

    const { rerender } = renderHook(
      ({ spot }) =>
        useChainOptionHold(holdSig, keys, viewId, { subscribeOptionSymbols: subscribe, releaseOptionHold: release }, spot),
      { initialProps: { spot: 600 as number | null } },
    );

    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 30; i++) {
      rerender({ spot: 600 + i * 0.1 });
    }
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });

  it("re-subscribes once when holdSig changes", async () => {
    const subscribe = vi.fn().mockResolvedValue("holder-2");
    const release = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ sig, keys }) =>
        useChainOptionHold(sig, keys, "chain:SPY:a", { subscribeOptionSymbols: subscribe, releaseOptionHold: release }, 600),
      {
        initialProps: {
          sig: "chain:SPY:a\nK1",
          keys: ["K1"],
        },
      },
    );

    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
    rerender({ sig: "chain:SPY:a\nK2", keys: ["K2"] });
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
  });
});