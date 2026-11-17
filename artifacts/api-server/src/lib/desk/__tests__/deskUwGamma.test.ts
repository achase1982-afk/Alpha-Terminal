import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deskUwExtractRows,
  deskRefreshLiveGamma0dte,
  deskRefreshLiveGamma,
  deskGetCachedLiveGamma0dte,
  deskGetCachedLiveGamma,
  deskUwResetGammaCachesForTests,
} from "../deskUwGamma.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, "fixtures", name), "utf8")) as unknown;

vi.mock("../deskUwHttp.js", () => ({
  deskUwGet: vi.fn(),
}));

vi.mock("../deskUnusualWhales.js", () => ({
  getUwApiKey: () => "test-key",
}));

describe("deskUwGamma", () => {
  beforeEach(() => {
    deskUwResetGammaCachesForTests();
    vi.resetAllMocks();
  });

  it("fetches live_gamma_0dte with expirations[] and date", async () => {
    const { deskUwGet } = await import("../deskUwHttp.js");
    vi.mocked(deskUwGet).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: fixture("uw-expiry-strike-page0.json"),
      asOfMs: 1_700_000_000_000,
    });
    const snap = await deskRefreshLiveGamma0dte("2026-11-17", "SPX");
    expect(snap?.row_count).toBe(1);
    const url = vi.mocked(deskUwGet).mock.calls[0]?.[0] ?? "";
    expect(url).toContain("expirations%5B%5D=2026-11-17");
    expect(url).toContain("limit=500");
    expect(url).toContain("/spot-exposures/expiry-strike");
    expect(deskGetCachedLiveGamma0dte("2026-11-17", "SPX")?.row_count).toBe(1);
  });

  it("fetches live_gamma spot-exposures with date only (no paging)", async () => {
    const { deskUwGet } = await import("../deskUwHttp.js");
    vi.mocked(deskUwGet).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: fixture("uw-spot-exposures.json"),
      asOfMs: 1_700_000_000_000,
    });
    const snap = await deskRefreshLiveGamma("2026-11-17", "SPX");
    expect(snap?.row_count).toBe(1);
    const url = vi.mocked(deskUwGet).mock.calls[0]?.[0] ?? "";
    expect(url).toContain("/spot-exposures?date=2026-11-17");
    expect(url).not.toContain("limit=");
    expect(deskUwExtractRows(fixture("uw-spot-exposures.json"))).toHaveLength(1);
    expect(deskGetCachedLiveGamma("2026-11-17", "SPX")?.row_count).toBe(1);
  });
});