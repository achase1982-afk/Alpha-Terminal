import { describe, expect, it, vi, beforeEach } from "vitest";
import { deskFilterTicksSince, deskParseSinceMs, deskFetchNetPremTicks } from "../deskUwNetPrem.js";

vi.mock("../deskUwHttp.js", () => ({
  deskUwGet: vi.fn(),
}));

vi.mock("../deskUnusualWhales.js", () => ({
  getUwApiKey: () => "test-key",
}));

describe("deskUwNetPrem", () => {
  beforeEach(() => vi.resetAllMocks());

  it("parses since as epoch ms and ISO", () => {
    expect(deskParseSinceMs("1700000000000")).toBe(1_700_000_000_000);
    expect(deskParseSinceMs("2026-11-17T15:00:00.000Z")).toBe(Date.parse("2026-11-17T15:00:00.000Z"));
  });

  it("filters ticks at or after since_ms", () => {
    const rows = [
      { timestamp: 1_699_999_000_000 },
      { timestamp: 1_700_000_500_000 },
    ];
    expect(deskFilterTicksSince(rows, 1_700_000_000_000)).toHaveLength(1);
  });

  it("fetches net prem ticks from UW", async () => {
    const { deskUwGet } = await import("../deskUwHttp.js");
    vi.mocked(deskUwGet).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: { data: [{ timestamp: 1_700_000_000_000, net_prem: 1 }] },
      asOfMs: 1_700_000_000_100,
    });
    const r = await deskFetchNetPremTicks({ ticker: "SPX", sinceMs: 1_700_000_000_000 });
    expect(r.ok).toBe(true);
    expect(r.ticks).toHaveLength(1);
    expect(vi.mocked(deskUwGet).mock.calls[0]?.[0]).toContain("/net-prem-ticks");
  });
});