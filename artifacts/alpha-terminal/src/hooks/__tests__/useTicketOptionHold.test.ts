/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useTicketOptionHold } from "../useTicketOptionHold";

describe("useTicketOptionHold", () => {
  beforeEach(() => vi.clearAllMocks());

  it("re-posts hold after close and reopen with same holdSig", async () => {
    const subscribe = vi.fn().mockResolvedValue("ticket-h1");
    const release = vi.fn().mockResolvedValue(undefined);
    const holdSig = "ticket:SPY:abc\nLEG1";
    const keys = ["LEG1"];
    const viewId = "ticket:SPY:abc";

    const { rerender } = renderHook(
      ({ open }) =>
        useTicketOptionHold(open, holdSig, viewId, keys, {
          subscribeOptionSymbols: subscribe,
          releaseOptionHold: release,
        }),
      { initialProps: { open: true } },
    );

    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
    rerender({ open: false });
    await waitFor(() => expect(release).toHaveBeenCalled());
    subscribe.mockClear();
    release.mockClear();
    rerender({ open: true });
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
  });

  it("ignores new strategyLegs array identity when holdSig unchanged", async () => {
    const subscribe = vi.fn().mockResolvedValue("ticket-h2");
    const release = vi.fn().mockResolvedValue(undefined);
    const holdSig = "ticket:QQQ:x\nSYM";
    const viewId = "ticket:QQQ:x";

    const { rerender } = renderHook(
      ({ keys }) =>
        useTicketOptionHold(true, holdSig, viewId, keys, {
          subscribeOptionSymbols: subscribe,
          releaseOptionHold: release,
        }),
      { initialProps: { keys: ["SYM"] } },
    );

    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
    rerender({ keys: ["SYM"] });
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });
});
