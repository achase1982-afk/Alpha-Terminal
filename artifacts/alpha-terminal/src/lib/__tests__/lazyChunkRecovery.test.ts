/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHUNK_RELOAD_GUARD_KEY,
  hasUnsavedTradingState,
  isChunkLoadError,
  setLazyRecoveryTradeLatch,
  tryGuardedFullReload,
} from "../lazyChunkRecovery";
import { useChainDraftSessionStore } from "../orders/chainDraftSessionStore";

describe("lazyChunkRecovery", () => {
  beforeEach(() => {
    setLazyRecoveryTradeLatch(false);
    useChainDraftSessionStore.getState().clear();
    sessionStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects dynamic import failures", () => {
    expect(isChunkLoadError(new Error("Failed to fetch dynamically imported module: /assets/x.js"))).toBe(true);
    expect(isChunkLoadError(new Error("other"))).toBe(false);
  });

  it("respects trade latch for unsaved state", () => {
    setLazyRecoveryTradeLatch(true);
    expect(hasUnsavedTradingState()).toBe(true);
  });

  it("detects chain draft strip in DOM", () => {
    document.body.innerHTML = '<div data-chain-draft-strip></div>';
    expect(hasUnsavedTradingState()).toBe(true);
  });

  it("detects hoisted chain draft session store", () => {
    useChainDraftSessionStore.getState().setDraft("$SPX", {
      selectedLegs: [
        {
          key: "x",
          contract: { strike: 100 },
          type: "PUT",
          expiration: "2025-01-01",
          side: "ask",
        },
      ],
    });
    expect(hasUnsavedTradingState()).toBe(true);
  });

  it("blocks guarded reload when unsaved", () => {
    setLazyRecoveryTradeLatch(true);
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    expect(tryGuardedFullReload("test")).toBe("blocked-unsaved");
    expect(reload).not.toHaveBeenCalled();
  });

  it("applies sessionStorage reload guard", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, String(Date.now()));
    expect(tryGuardedFullReload("test")).toBe("blocked-loop");
    expect(reload).not.toHaveBeenCalled();
  });
});