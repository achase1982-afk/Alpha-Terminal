import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../tokenStore.js", () => ({
  getBestAccessToken: vi.fn(),
}));

import { getBestAccessToken } from "../tokenStore.js";
import { getEquityMarketSessionWithAsOf, __resetEquityMarketSessionCacheForTests } from "../schwabMarketHours.js";

const mockToken = vi.mocked(getBestAccessToken);

describe("getEquityMarketSessionWithAsOf (API / auth failures)", () => {
  beforeEach(() => {
    __resetEquityMarketSessionCacheForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns unknown when no access token (do not assume closed)", async () => {
    mockToken.mockReturnValue(null);
    const r = await getEquityMarketSessionWithAsOf();
    expect(r.session).toBe("unknown");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns unknown on non-OK HTTP response", async () => {
    mockToken.mockReturnValue("test-token");
    const r = await getEquityMarketSessionWithAsOf();
    expect(r.session).toBe("unknown");
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it("returns unknown when response body has no parseable session windows", async () => {
    mockToken.mockReturnValue("test-token");
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ equity: {} }),
    } as Response);
    const r = await getEquityMarketSessionWithAsOf();
    expect(r.session).toBe("unknown");
  });

  it("returns open when windows classify current instant inside regular session", async () => {
    mockToken.mockReturnValue("test-token");
    const t = Date.UTC(2026, 4, 3, 17, 0, 0);
    vi.spyOn(Date, "now").mockReturnValue(t);
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        equity: {
          EQ: {
            sessionHours: {
              regularMarket: [
                {
                  start: new Date(t - 3_600_000).toISOString(),
                  end: new Date(t + 3_600_000).toISOString(),
                },
              ],
            },
          },
        },
      }),
    } as Response);
    const r = await getEquityMarketSessionWithAsOf();
    expect(r.session).toBe("open");
    vi.restoreAllMocks();
  });
});
