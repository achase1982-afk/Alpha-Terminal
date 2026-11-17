import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deskUwExtractRows,
  deskUwFilterByExpiry,
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

  it("filters expiry-strike rows to one ET expiry", () => {
    const rows = deskUwExtractRows(fixture("uw-expiry-strike-page0.json"));
    const filtered = deskUwFilterByExpiry(rows, "2026-11-17");
    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => (r as { expiry: string }).expiry === "2026-11-17")).toBe(true);
  });

  it("fetches live_gamma_0dte with limit=500 page=0", async () => {
    const { deskUwGet } = await import("../deskUwHttp.js");
    const { deskFetchLiveGamma0dte } = await import("../deskUwGamma.js");
    vi.mocked(deskUwGet).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: fixture("uw-expiry-strike-page0.json"),
      asOfMs: 1_700_000_000_000,
    });
    const snap = await deskFetchLiveGamma0dte("2026-11-17", "SPX");
    expect(snap?.row_count).toBe(2);
    expect(vi.mocked(deskUwGet).mock.calls[0]?.[0]).toContain("limit=500&page=0");
    expect(vi.mocked(deskUwGet).mock.calls[0]?.[0]).toContain("/spot-exposures/expiry-strike");
  });

  it("uses spot-exposures path for live_gamma", async () => {
    const { deskUwGet } = await import("../deskUwHttp.js");
    const { deskFetchLiveGamma } = await import("../deskUwGamma.js");
    vi.mocked(deskUwGet).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: fixture("uw-spot-exposures.json"),
      asOfMs: 1_700_000_000_000,
    });
    const snap = await deskFetchLiveGamma("2026-11-17", "SPX");
    expect(snap?.row_count).toBe(1);
    expect(vi.mocked(deskUwGet).mock.calls[0]?.[0]).toContain("/spot-exposures?");
    expect(vi.mocked(deskUwGet).mock.calls[0]?.[0]).not.toContain("expiry-strike");
  });
});