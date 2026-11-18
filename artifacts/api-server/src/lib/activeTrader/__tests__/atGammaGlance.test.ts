import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAtGammaGlancePayload,
  resetAtGammaGlanceCacheForTests,
} from "../atGammaGlance.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(
    join(here, "../../../../../../lib/order-ticket-math/src/__tests__/fixtures/uw-spx-gamma-0dte-2026-11-17.json"),
    "utf8",
  ),
) as { data: unknown[] };

const refresh = vi.fn();
const getCached = vi.fn();

vi.mock("../../desk/addons/unusualWhales/deskUwGamma.js", () => ({
  deskUwExtractRows: (raw: unknown) => {
    if (raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown[] }).data)) {
      return (raw as { data: unknown[] }).data;
    }
    if (Array.isArray(raw)) return raw;
    return [];
  },
  deskRefreshLiveGamma0dte: (...args: unknown[]) => refresh(...args),
  deskGetCachedLiveGamma0dte: (...args: unknown[]) => getCached(...args),
}));

vi.mock("../../desk/deskFeedFreshness.js", () => ({
  buildDeskHealthFeeds: () => [{ feed: "live_gamma_0dte", status: "session_closed" }],
}));

vi.mock("../../desk/deskEt.js", () => ({
  deskSessionDateEt: () => "2026-11-17",
}));

describe("buildAtGammaGlancePayload", () => {
  beforeEach(() => {
    resetAtGammaGlanceCacheForTests();
    refresh.mockReset();
    getCached.mockReset();
  });

  it("refreshes on miss then caches derived SPX zones", async () => {
    const now = Date.now();
    const snap = {
      data: { data: fixture.data, date: "2026-11-17", expiry: "2026-11-17", ticker: "SPX" },
      asOfMs: now,
      cachedAtMs: now,
      row_count: fixture.data.length,
      date: "2026-11-17",
      expiry: "2026-11-17",
      ticker: "SPX",
    };
    getCached.mockReturnValueOnce(null).mockReturnValue(snap);

    const first = await buildAtGammaGlancePayload("SPX");
    expect(refresh).toHaveBeenCalledWith("2026-11-17", "SPX");
    expect(first.unavailable).toBe(false);
    expect(first.zones.callWall).toBe(7340);
    expect(first.glanceCaption).toMatch(/Closed/);

    refresh.mockClear();
    const second = await buildAtGammaGlancePayload("SPX");
    expect(refresh).not.toHaveBeenCalled();
    expect(second.zones.flip).toBe(first.zones.flip);
  });
});