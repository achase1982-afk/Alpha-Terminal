import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DESK_UW_CACHE_TTL_MS } from "../../../deskPollCadence.js";

describe("deskUw flow cache TTL", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T16:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lookup 80s after poll still hits", async () => {
    const {
      deskResetUwFlowCacheForTests,
      deskSeedUwFlowCacheForTests,
      deskGetCachedUwFlow,
    } = await import("../deskUnusualWhales.js");
    deskResetUwFlowCacheForTests();
    const seededAt = Date.now();
    deskSeedUwFlowCacheForTests([{ ticker: "QQQ" }], seededAt);
    vi.setSystemTime(seededAt + 80_000);
    expect(deskGetCachedUwFlow(undefined, seededAt + 80_000)).not.toBeNull();
    vi.setSystemTime(seededAt + DESK_UW_CACHE_TTL_MS + 1);
    expect(deskGetCachedUwFlow(undefined, seededAt + DESK_UW_CACHE_TTL_MS + 1)).toBeNull();
  });
});
